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
import { MembershipService } from '../mem/membership.service';

/**
 * The two ways out of the vault that are a person rather than a parcel.
 *
 * Every route out used to be a carrier: a shipment had to resolve to a rate,
 * dispatch bought a label and stamped a tracking number, and there was no
 * fulfilment method that was not a package. Two of the reference service's
 * outbound routes are a human being.
 *
 * WHITE GLOVE is somebody driving the card there and putting it in a hand. It
 * cannot be priced from a rate card, because the cost of getting a person from
 * New Jersey to a hotel in Boston on a Tuesday is not something a lookup knows —
 * so it is a QUOTE: the collector says where, when and where to, Bault works out
 * the journey and comes back with a figure, and the collector accepts or does
 * not. That round trip is the feature, not an inconvenience around it.
 *
 * SHOW PICKUP is the cards travelling to a show Bault is already attending, and
 * the collector walking up and taking them. It is cheap for one reason worth
 * stating plainly: the van was going anyway. It is not a discount, it is the
 * absence of a journey — which is also why it is capped per show and gated on
 * the same deadline the consignments use. It is the same van.
 *
 * Both end the same way, and differently from a parcel: there is no carrier scan
 * to close them, so they are closed by a person putting a name to having taken
 * the thing.
 */
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

  /* ------------------------------------------------------------------
     White glove
     ------------------------------------------------------------------ */

  /** The published terms, so somebody can see the shape of the price first. */
  async whiteGloveTerms() {
    const [domestic, international] = await Promise.all([
      this.pricing.tryPrice(whiteGloveFeeAction('domestic')),
      this.pricing.tryPrice(whiteGloveFeeAction('international')),
    ]);
    return {
      baseDomesticMinor: domestic?.amount.amount ?? WHITE_GLOVE_BASE_DOMESTIC_MINOR,
      baseInternationalMinor: international?.amount.amount ?? WHITE_GLOVE_BASE_INTERNATIONAL_MINOR,
      quoteWithinHours: WHITE_GLOVE_QUOTE_HOURS,
      /** Travel is on top and is quoted per journey. There is no rate card. */
      travelQuotedSeparately: true,
    };
  }

  /**
   * Ask for a card to be hand-delivered.
   *
   * Creates a shipment with no carrier and no price. `quoteMinor` stays null,
   * which is a real state rather than a missing value: this is a question, and
   * Bault has to go and find out the answer.
   */
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

    const [created] = await this.db
      .insert(shipment)
      .values({
        code: newShipmentCode(),
        userId,
        itemIds: items.map((i) => i.id),
        fulfilmentMethod: 'hand_delivery',
        destinationAddress: input.deliveryAddress.trim(),
        destinationCountry: input.destinationCountry.trim().toUpperCase(),
        // A hand delivery has no postal routing: a person is walking to a door.
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

    await this.db.transaction(async (tx) => {
      await this.outbox.emit(tx, {
        aggregateType: 'shipment',
        aggregateId: created.id,
        eventType: 'white_glove_requested',
        payload: { userId, shipmentCode: created.code, quoteWithinHours: WHITE_GLOVE_QUOTE_HOURS },
      });
    });
    return created;
  }

  /** Somebody has worked out the journey. This is the figure. */
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

    const [s] = await this.db.select().from(shipment).where(eq(shipment.id, shipmentId)).limit(1);
    if (!s) throw AppError.notFound('Shipment not found');
    if (s.fulfilmentMethod !== 'hand_delivery') throw AppError.validation('That is not a hand-delivery request');
    if (s.status !== 'requested') {
      throw new AppError(ErrorCode.CONFLICT, 'That request is no longer open to a quote', 409);
    }

    const now = new Date();
    return this.db.transaction(async (tx) => {
      await tx
        .update(shipment)
        .set({
          quoteMinor: form.quoteMinor,
          quoteNotes: form.notes.trim(),
          quotedBy: operatorId,
          quotedAt: now,
          updatedAt: now,
        })
        .where(eq(shipment.id, shipmentId));
      await this.outbox.emit(tx, {
        aggregateType: 'shipment',
        aggregateId: shipmentId,
        eventType: 'white_glove_quoted',
        payload: { userId: s.userId, shipmentCode: s.code, quoteMinor: form.quoteMinor },
      });
      return { quoteMinor: form.quoteMinor, quotedAt: now };
    });
  }

  /**
   * The collector takes the quote.
   *
   * Charged at the quoted figure and nothing else. A quote that moved between
   * being given and being accepted would not be a quote.
   */
  async acceptQuote(shipmentId: string, actor: ShipmentActor) {
    const s = await this.shipments.loadFor(shipmentId, actor);
    if (s.fulfilmentMethod !== 'hand_delivery') throw AppError.validation('That is not a hand-delivery request');
    if (s.quoteMinor === null) throw new AppError(ErrorCode.CONFLICT, 'No quote yet', 409);
    if (s.status !== 'requested') throw new AppError(ErrorCode.CONFLICT, 'Already accepted', 409);

    const balance = await this.ledger.balanceOf(s.userId);
    if (balance.amount < s.quoteMinor) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Short by ${formatMinor(s.quoteMinor - balance.amount)}. Top up the wallet and accept again.`,
        409,
      );
    }

    return this.db.transaction(async (tx) => {
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
      await tx
        .update(shipment)
        .set({ status: 'rates_selected', cost: s.quoteMinor, updatedAt: new Date() })
        .where(eq(shipment.id, shipmentId));
      return { status: 'rates_selected' as const, cost: s.quoteMinor };
    });
  }

  /* ------------------------------------------------------------------
     Show pickup
     ------------------------------------------------------------------ */

  /**
   * Shows you can collect at, with what is left of each one's capacity.
   *
   * The remaining count is computed rather than stored, so it cannot drift from
   * the pickups actually booked.
   */
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
          /** Null means uncapped. */
          remaining,
          open: show.requestDeadline.getTime() > now && (remaining === null || remaining > 0),
          notes: show.notes,
        };
      }),
    );
  }

  /**
   * Book a pickup at a show.
   *
   * Charged on the spot, because there is nothing to quote and nothing to
   * select: the fee is the show's, the van is going, and the only question was
   * whether there was room.
   */
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
      /**
       * A membership may cover the pickup. Worked out BEFORE the balance check,
       * which used to run against the full fee outside the transaction — so a
       * member whose tier pays for the pickup could be refused for being short of
       * money they were never going to be charged.
       */
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
          // The show is the delivery date. Nothing is estimated about it.
          estimatedDeliveryAt: show.startsAt,
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

  /* ------------------------------------------------------------------
     The hand-over
     ------------------------------------------------------------------ */

  /**
   * Somebody took it.
   *
   * This is what closes a shipment that has no tracking number. A parcel is
   * closed by a carrier scan; these two are closed by a person putting a name to
   * having received the cards, and by the same scan-verification a dispatch
   * uses — an operator handing over a box at a show still has to confirm that
   * what is in the box is what the request says.
   */
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
