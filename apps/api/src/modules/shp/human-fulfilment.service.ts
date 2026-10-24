import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { newShipmentCode } from '../../shared/ids';
import { CustodyService } from '../cst/custody.service';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { WalletService } from '../pay/wallet.service';
import { PricingService } from '../prc/pricing.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { charge } from '../pay/pay.schema';
import { consignmentEvent } from '../dis/consignment-event.schema';
import { shipment } from './shp.schema';
import { ParcelProfileService } from './parcel-profile.service';
import { ShipmentService, type ShipmentActor } from './shipment.service';
import {
  PICKUP_FEE_ACTION,
  WHITE_GLOVE_BASE_DOMESTIC_MINOR,
  WHITE_GLOVE_BASE_INTERNATIONAL_MINOR,
  WHITE_GLOVE_QUOTE_HOURS,
  checkHandDelivery,
  whiteGloveFeeAction,
} from './fulfilment';
import { formatMinor } from '../../shared/money';
import { MembershipService, type AppliedShippingCover } from '../mem/membership.service';

function pickupCover(tier: string | null, periodId: string): AppliedShippingCover {
  return {
    tier: tier ?? '',
    insuredShipment: false,
    insuranceMinor: 0,
    postageMinor: 0,
    rushMinor: 0,
    addOns: { show_pickup: 1 },
    spentInPeriodId: periodId,
  };
}

@Injectable()
export class HumanFulfilmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly pricing: PricingService,
    private readonly outbox: OutboxService,
    private readonly profiles: ParcelProfileService,
    private readonly shipments: ShipmentService,
    private readonly memberships: MembershipService,
  ) {}

  async whiteGloveTerms() {
    const [domestic, international] = await Promise.all([
      this.pricing.tryPrice(whiteGloveFeeAction('domestic')),
      this.pricing.tryPrice(whiteGloveFeeAction('international')),
    ]);
    return {
      baseDomesticMinor: domestic?.amount.amount ?? WHITE_GLOVE_BASE_DOMESTIC_MINOR,
      baseInternationalMinor: international?.amount.amount ?? WHITE_GLOVE_BASE_INTERNATIONAL_MINOR,
      quoteWithinHours: WHITE_GLOVE_QUOTE_HOURS,
      travelQuotedSeparately: true,
    };
  }

  async requestHandDelivery(
    userId: string,
    input: {
      itemIds: string[];
      pickupAddress: string;
      pickupFrom: string;
      pickupTo: string;
      deliveryAddress: string;
      deliverFrom: string;
      deliverTo: string;
      destinationCountry: string;
      recipientName?: string;
      customerNotes?: string;
    },
  ) {
    await this.wallet.assertNotBlocked(userId);
    const items = await this.profiles.loadShippableItems(userId, input.itemIds);
    await this.shipments.assertItemsFree(userId, items.map((i) => i.id));

    const problems = checkHandDelivery({
      pickupFrom: new Date(input.pickupFrom),
      pickupTo: new Date(input.pickupTo),
      deliverFrom: new Date(input.deliverFrom),
      deliverTo: new Date(input.deliverTo),
      pickupAddress: input.pickupAddress,
      deliveryAddress: input.deliveryAddress,
    });
    if (problems.length > 0) throw AppError.validation(problems[0]!.message, { problems });

    return this.db.transaction(async (tx) => {
      await this.profiles.loadShippableItems(userId, input.itemIds, tx as Database);
      await this.shipments.assertItemsFree(userId, items.map((i) => i.id), undefined, tx as Database);
      const [created] = await tx
        .insert(shipment)
        .values({
          code: newShipmentCode(),
          userId,
          itemIds: items.map((i) => i.id),
          fulfilmentMethod: 'hand_delivery',
          destinationAddress: input.deliveryAddress.trim(),
          destinationCountry: input.destinationCountry.trim().toUpperCase(),
          destinationPostalCode: '',
          recipientName: input.recipientName?.trim() || null,
          pickupAddress: input.pickupAddress.trim(),
          pickupFrom: new Date(input.pickupFrom),
          pickupTo: new Date(input.pickupTo),
          deliverFrom: new Date(input.deliverFrom),
          deliverTo: new Date(input.deliverTo),
          customerNotes: input.customerNotes?.trim() || null,
          currency: DEFAULT_CURRENCY,
          status: 'requested',
        })
        .returning();
      if (!created) throw AppError.validation('Failed to raise the request');

      await this.outbox.emit(tx, {
        aggregateType: 'shipment',
        aggregateId: created.id,
        eventType: 'white_glove_requested',
        payload: { userId, shipmentCode: created.code, quoteWithinHours: WHITE_GLOVE_QUOTE_HOURS },
      });
      return created;
    });
  }

  async quoteHandDelivery(
    operatorId: string,
    shipmentId: string,
    form: { quoteMinor: number; notes: string },
  ) {
    if (!Number.isInteger(form.quoteMinor) || form.quoteMinor <= 0) {
      throw AppError.validation('A quote needs a figure');
    }
    if (!form.notes?.trim()) {
      throw AppError.validation('Say what the figure covers — the journey, the base, anything unusual.');
    }

    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Shipment not found');
      if (s.fulfilmentMethod !== 'hand_delivery') throw AppError.validation('That is not a hand-delivery request');
      if (s.status !== 'requested') {
        throw new AppError(ErrorCode.CONFLICT, 'That request is no longer open to a quote', 409);
      }

      const [quoted] = await tx
        .update(shipment)
        .set({
          quoteMinor: form.quoteMinor,
          quoteNotes: form.notes.trim(),
          quotedBy: operatorId,
          quotedAt: now,
          updatedAt: now,
        })
        .where(and(eq(shipment.id, shipmentId), eq(shipment.status, 'requested')))
        .returning({ id: shipment.id });
      if (!quoted) throw new AppError(ErrorCode.CONFLICT, 'That request is no longer open to a quote', 409);
      await this.outbox.emit(tx, {
        aggregateType: 'shipment',
        aggregateId: shipmentId,
        eventType: 'white_glove_quoted',
        payload: { userId: s.userId, shipmentCode: s.code, quoteMinor: form.quoteMinor },
      });
      return { quoteMinor: form.quoteMinor, quotedAt: now };
    });
  }

  async acceptQuote(shipmentId: string, actor: ShipmentActor, seenMinor: number) {
    await this.shipments.loadFor(shipmentId, actor);

    return this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Shipment not found');
      if (s.fulfilmentMethod !== 'hand_delivery') throw AppError.validation('That is not a hand-delivery request');
      if (s.quoteMinor === null) throw new AppError(ErrorCode.CONFLICT, 'No quote yet', 409);
      if (s.status !== 'requested') throw new AppError(ErrorCode.CONFLICT, 'Already accepted', 409);
      if (s.quoteMinor !== seenMinor) {
        throw new AppError(
          ErrorCode.QUOTE_CHANGED,
          `The quote changed to ${formatMinor(s.quoteMinor)}. Check it and accept again.`,
          409,
          { quoteMinor: s.quoteMinor },
        );
      }

      await this.ledger.lockWallet(s.userId, tx as Database);
      const balance = await this.ledger.balanceOf(s.userId, tx);
      if (balance.amount < s.quoteMinor) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Short by ${formatMinor(s.quoteMinor - balance.amount)}. Top up the wallet and accept again.`,
          409,
        );
      }

      const [c] = await tx
        .insert(charge)
        .values({
          userId: s.userId,
          actionType: 'shipping',
          pricingRuleSnapshot: { whiteGlove: true, quoteMinor: s.quoteMinor, quotedBy: s.quotedBy },
          amount: s.quoteMinor!,
          currency: s.currency ?? DEFAULT_CURRENCY,
          paymentMeans: 'wallet',
          status: 'settled',
          referenceId: s.id,
        })
        .returning({ id: charge.id });
      if (!c) throw AppError.validation('Failed to charge for the delivery');
      await this.ledger.record(
        {
          userId: s.userId,
          type: 'service_charge',
          amount: s.quoteMinor!,
          direction: 'debit',
          currency: s.currency ?? DEFAULT_CURRENCY,
          referenceType: 'charge',
          referenceId: c.id,
        },
        tx,
      );
      const [accepted] = await tx
        .update(shipment)
        .set({ status: 'rates_selected', cost: s.quoteMinor, updatedAt: new Date() })
        .where(
          and(eq(shipment.id, shipmentId), eq(shipment.status, 'requested'), eq(shipment.quoteMinor, s.quoteMinor)),
        )
        .returning({ id: shipment.id });
      if (!accepted) throw new AppError(ErrorCode.CONFLICT, 'That quote is no longer open', 409);
      return { status: 'rates_selected' as const, cost: s.quoteMinor };
    });
  }

  async pickupShows() {
    const rows = await this.db
      .select()
      .from(consignmentEvent)
      .where(and(eq(consignmentEvent.active, true), eq(consignmentEvent.pickupEnabled, true)))
      .orderBy(consignmentEvent.startsAt);

    const fallback = await this.pricing.tryPrice(PICKUP_FEE_ACTION);
    const now = Date.now();

    return Promise.all(
      rows.map(async (show) => {
        const [countRow] = await this.db
          .select({ booked: sql<number>`count(*)::int` })
          .from(shipment)
          .where(
            and(
              eq(shipment.pickupEventId, show.id),
              sql`${shipment.status} not in ('cancelled')`,
            ),
          );
        const booked = countRow?.booked ?? 0;
        const feeMinor = show.pickupFeeMinor > 0 ? show.pickupFeeMinor : (fallback?.amount.amount ?? 0);
        const remaining = show.pickupCapacity > 0 ? Math.max(0, show.pickupCapacity - booked) : null;
        return {
          id: show.id,
          name: show.name,
          venue: show.venue,
          city: show.city,
          startsAt: show.startsAt,
          endsAt: show.endsAt,
          requestDeadline: show.requestDeadline,
          feeMinor,
          capacity: show.pickupCapacity,
          booked,
          remaining,
          open: show.requestDeadline.getTime() > now && (remaining === null || remaining > 0),
          notes: show.notes,
        };
      }),
    );
  }

  async requestPickup(
    userId: string,
    input: { itemIds: string[]; eventId: string; customerNotes?: string },
  ) {
    await this.wallet.assertNotBlocked(userId);
    const items = await this.profiles.loadShippableItems(userId, input.itemIds);
    await this.shipments.assertItemsFree(userId, items.map((i) => i.id));

    const shows = await this.pickupShows();
    const show = shows.find((x) => x.id === input.eventId);
    if (!show) throw AppError.validation('That show does not take pickups');
    if (show.requestDeadline.getTime() <= Date.now()) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'That show has closed to new requests — the van is packed before the doors open.',
        409,
      );
    }
    if (show.remaining !== null && show.remaining <= 0) {
      throw new AppError(ErrorCode.CONFLICT, 'That show is full for pickups', 409);
    }

    return this.db.transaction(async (tx) => {
      await this.profiles.loadShippableItems(userId, input.itemIds, tx as Database);
      await this.shipments.assertItemsFree(userId, items.map((i) => i.id), undefined, tx as Database);

      const [locked] = await tx
        .select()
        .from(consignmentEvent)
        .where(eq(consignmentEvent.id, show.id))
        .for('update')
        .limit(1);
      if (!locked || !locked.active || !locked.pickupEnabled) {
        throw AppError.validation('That show does not take pickups');
      }
      if (locked.requestDeadline.getTime() <= Date.now()) {
        throw new AppError(ErrorCode.CONFLICT, 'That show has closed to new requests — the van is packed before the doors open.', 409);
      }
      if (locked.pickupCapacity > 0) {
        const [taken] = await tx
          .select({ booked: sql<number>`count(*)::int` })
          .from(shipment)
          .where(and(eq(shipment.pickupEventId, show.id), sql`${shipment.status} not in ('cancelled')`));
        if ((taken?.booked ?? 0) >= locked.pickupCapacity) {
          throw new AppError(ErrorCode.CONFLICT, 'That show is full for pickups', 409);
        }
      }

      await this.ledger.lockWallet(userId, tx as Database);
      const waiver = await this.memberships.waive(tx as Database, userId, 'show_pickup', show.feeMinor);
      const feeMinor = show.feeMinor - waiver.waivedMinor;
      const balance = await this.ledger.balanceOf(userId, tx as Database);
      if (balance.amount < feeMinor) {
        throw new AppError(ErrorCode.CONFLICT, `Short by ${formatMinor(feeMinor - balance.amount)}.`, 409);
      }

      const [created] = await tx
        .insert(shipment)
        .values({
          code: newShipmentCode(),
          userId,
          itemIds: items.map((i) => i.id),
          fulfilmentMethod: 'show_pickup',
          pickupEventId: show.id,
          destinationAddress: `${show.name}, ${show.venue}${show.city ? `, ${show.city}` : ''}`,
          destinationCountry: 'US',
          destinationPostalCode: '',
          customerNotes: input.customerNotes?.trim() || null,
          cost: feeMinor,
          currency: DEFAULT_CURRENCY,
          status: 'rates_selected',
          estimatedDeliveryAt: show.startsAt,
          membershipCover: waiver.periodId ? pickupCover(waiver.tier, waiver.periodId) : null,
        })
        .returning();
      if (!created) throw AppError.validation('Failed to book the pickup');

      if (feeMinor > 0) {
        const [c] = await tx
          .insert(charge)
          .values({
            userId,
            actionType: 'shipping',
            pricingRuleSnapshot: { showPickup: true, eventId: show.id, showName: show.name },
            amount: feeMinor,
            currency: DEFAULT_CURRENCY,
            paymentMeans: 'wallet',
            status: 'settled',
            referenceId: created.id,
          })
          .returning({ id: charge.id });
        if (!c) throw AppError.validation('Failed to charge the pickup fee');
        await this.ledger.record(
          {
            userId,
            type: 'service_charge',
            amount: feeMinor,
            direction: 'debit',
            currency: DEFAULT_CURRENCY,
            referenceType: 'charge',
            referenceId: c.id,
          },
          tx,
        );
      }

      await this.outbox.emit(tx, {
        aggregateType: 'shipment',
        aggregateId: created.id,
        eventType: 'show_pickup_booked',
        payload: { userId, shipmentCode: created.code, showName: show.name, startsAt: show.startsAt },
      });
      return created;
    });
  }

  async handOver(
    operatorId: string,
    shipmentId: string,
    form: { scannedItemIds: string[]; handedToName: string; notes: string },
  ) {
    if (!form.handedToName?.trim()) throw AppError.validation('Record who took it');
    if (!form.notes?.trim()) throw AppError.validation('Notes are required');

    return this.custody.run(async (tx) => {
      const [s] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Shipment not found');
      if (s.fulfilmentMethod === 'carrier') {
        throw AppError.validation('A carrier shipment is closed by dispatch, not by a hand-over');
      }
      if (s.status !== 'rates_selected') {
        throw new AppError(ErrorCode.CONFLICT, 'That shipment is not ready to hand over', 409);
      }

      const expected = new Set(s.itemIds as string[]);
      const scanned = new Set(form.scannedItemIds);
      const matches = expected.size === scanned.size && [...expected].every((id) => scanned.has(id));
      if (!matches) {
        throw new AppError(ErrorCode.CONFLICT, 'Verified items do not match the shipment', 409, {
          expected: [...expected],
          scanned: [...scanned],
        });
      }

      await this.custody.lockItems(tx, [...expected]);
      for (const itemId of expected) await this.custody.lockExpecting(tx, itemId, { ownerId: s.userId });

      const now = new Date();
      const how = s.fulfilmentMethod === 'show_pickup' ? 'collected at a show' : 'hand-delivered';
      for (const itemId of expected) {
        await this.custody.changeState(tx, itemId, 'shipped', operatorId, how);
      }

      await tx
        .update(shipment)
        .set({
          status: 'delivered',
          handedToName: form.handedToName.trim(),
          handedOverAt: now,
          handedOverBy: operatorId,
          fulfillmentNotes: form.notes.trim(),
          fulfilledBy: operatorId,
          fulfilledAt: now,
          updatedAt: now,
        })
        .where(eq(shipment.id, shipmentId));

      await this.outbox.emit(tx, {
        aggregateType: 'shipment',
        aggregateId: shipmentId,
        eventType: 'handed_over',
        payload: {
          userId: s.userId,
          shipmentCode: s.code,
          handedToName: form.handedToName.trim(),
          method: s.fulfilmentMethod,
        },
      });

      return { status: 'delivered' as const, handedToName: form.handedToName.trim(), itemCount: expected.size };
    });
  }
}
