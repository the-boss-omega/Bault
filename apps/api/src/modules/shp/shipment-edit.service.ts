import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { charge, ledgerRecord } from '../pay/pay.schema';
import { parcel, parcelEvent } from '../inv/parcel.schema';
import { shipment } from './shp.schema';
import { ParcelProfileService } from './parcel-profile.service';
import { shippingBox } from './boxes';
import { ShipmentService, type ShipmentActor, type ShipmentOptionsInput } from './shipment.service';
import { MembershipService, type AppliedShippingCover } from '../mem/membership.service';
import { consignmentEvent } from '../dis/consignment-event.schema';
import {
  MAX_INSURED_VALUE_MINOR,
  RESTOCKING_FEE_MINOR,
  checkOptions,
  needsCustoms,
  signatureForced,
} from './shipping-options';

@Injectable()
export class ShipmentEditService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly shipments: ShipmentService,
    private readonly profiles: ParcelProfileService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly memberships: MembershipService,
  ) {}

  private async loadEditable(shipmentId: string, actor: ShipmentActor) {
    const s = await this.shipments.loadFor(shipmentId, actor);
    if (s.mergedIntoShipmentId) {
      throw new AppError(ErrorCode.CONFLICT, 'This request was merged into another', 409);
    }
    if (s.status !== 'requested') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `This request is ${s.status.replace(/_/g, ' ')} — it can no longer be changed. Cancel it instead.`,
        409,
      );
    }
    return s;
  }

  async update(
    shipmentId: string,
    actor: ShipmentActor,
    patch: ShipmentOptionsInput & { itemIds?: string[]; recipientName?: string },
  ) {
    const s = await this.loadEditable(shipmentId, actor);

    const itemIds = patch.itemIds ?? ((s.itemIds as string[]) ?? []);
    const items = await this.profiles.loadShippableItems(s.userId, itemIds);
    await this.shipments.assertItemsFree(s.userId, itemIds, s.id);

    const insuredValueMinor = patch.insuredValueMinor ?? s.insuredValueMinor;
    const declaredValueMinor = patch.declaredValueMinor ?? s.declaredValueMinor;
    const signatureRequired =
      (patch.signatureRequired ?? s.signatureRequired) || signatureForced(insuredValueMinor);
    const addOns = patch.addOns ?? ((s.addOns as { key: string }[]) ?? []).map((a) => a.key);

    const problems = checkOptions({
      insuredValueMinor,
      signatureRequired,
      customsValueMinor: declaredValueMinor,
      destinationCountry: s.destinationCountry,
      addOns,
    });
    if (problems.length > 0) throw AppError.validation(problems[0]!.message, { problems });

    const measurements = this.profiles.measure(items);
    const boxSize = patch.boxSize === undefined ? s.boxSize : patch.boxSize;
    const { box, problems: boxProblems } = this.profiles.boxFor(boxSize, items, measurements);
    if (boxProblems.length > 0) {
      throw AppError.validation(boxProblems[0]!.message, { problems: boxProblems });
    }
    const customsLines = needsCustoms(s.destinationCountry)
      ? this.profiles.buildCustomsLines(measurements, declaredValueMinor, patch.perItemCustomsValues)
      : null;

    const updated = await this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!cur || cur.status !== 'requested' || cur.mergedIntoShipmentId) {
        throw new AppError(ErrorCode.CONFLICT, 'This request has moved on and can no longer be changed.', 409);
      }
      await this.profiles.loadShippableItems(s.userId, itemIds, tx as Database);
      await this.shipments.assertItemsFree(s.userId, itemIds, s.id, tx as Database);

      const [row] = await tx
        .update(shipment)
        .set({
          itemIds: items.map((i) => i.id),
          insuredValueMinor,
          declaredValueMinor,
          signatureRequired,
          addOns: addOns.length > 0 ? addOns.map((key) => ({ key })) : null,
          boxSize: box?.key ?? null,
          customsLines,
          rushFlag: patch.rush ?? s.rushFlag,
          customerNotes:
            patch.customerNotes === undefined ? s.customerNotes : patch.customerNotes.trim() || null,
          recipientName: patch.recipientName?.trim() || s.recipientName,
          updatedAt: new Date(),
        })
        .where(and(eq(shipment.id, shipmentId), eq(shipment.status, 'requested')))
        .returning();
      return row;
    });
    if (!updated) {
      throw new AppError(ErrorCode.CONFLICT, 'This request has moved on and can no longer be changed.', 409);
    }
    return updated;
  }

  async merge(targetId: string, sourceId: string, actor: ShipmentActor) {
    if (targetId === sourceId) throw AppError.validation('That is the same request');
    const target = await this.loadEditable(targetId, actor);
    const source = await this.loadEditable(sourceId, actor);

    if (target.userId !== source.userId) throw AppError.forbidden('Those requests belong to different people');
    if (
      target.destinationAddress !== source.destinationAddress ||
      target.destinationCountry !== source.destinationCountry ||
      target.destinationPostalCode !== source.destinationPostalCode
    ) {
      throw AppError.validation('Those two requests are going to different addresses');
    }

    const merged = [...new Set([...((target.itemIds as string[]) ?? []), ...((source.itemIds as string[]) ?? [])])];
    const items = await this.profiles.loadShippableItems(target.userId, merged);
    const measurements = this.profiles.measure(items);

    const declaredValueMinor = target.declaredValueMinor + source.declaredValueMinor;
    const insuredValueMinor = Math.min(
      target.insuredValueMinor + source.insuredValueMinor,
      MAX_INSURED_VALUE_MINOR,
    );
    const signatureRequired =
      target.signatureRequired || source.signatureRequired || signatureForced(insuredValueMinor);
    const addOns = [
      ...new Set([
        ...((target.addOns as { key: string }[]) ?? []).map((a) => a.key),
        ...((source.addOns as { key: string }[]) ?? []).map((a) => a.key),
      ]),
    ];

    const customsLines = needsCustoms(target.destinationCountry)
      ? this.profiles.buildCustomsLines(measurements, declaredValueMinor)
      : null;

    const volume = (key: string | null) => {
      const d = shippingBox(key)?.dimensionsCm;
      return d ? d.length * d.width * d.height : 0;
    };
    const biggerBox = volume(source.boxSize) > volume(target.boxSize) ? source.boxSize : target.boxSize;
    const mergedBox = this.profiles.boxFor(biggerBox, items, measurements);
    const boxSize = mergedBox.problems.length === 0 ? (mergedBox.box?.key ?? null) : null;

    const notes = [target.customerNotes, source.customerNotes].filter(Boolean).join(' · ') || null;
    const now = new Date();

    return this.db.transaction(async (tx) => {
      for (const id of [targetId, sourceId].sort()) {
        const [row] = await tx.select().from(shipment).where(eq(shipment.id, id)).for('update').limit(1);
        if (!row || row.status !== 'requested' || row.mergedIntoShipmentId) {
          throw new AppError(ErrorCode.CONFLICT, 'One of those requests has moved on and can no longer be merged.', 409);
        }
      }
      await tx
        .update(shipment)
        .set({
          itemIds: merged,
          declaredValueMinor,
          insuredValueMinor,
          signatureRequired,
          addOns: addOns.length > 0 ? addOns.map((key) => ({ key })) : null,
          boxSize,
          customsLines,
          customerNotes: notes,
          rushFlag: target.rushFlag || source.rushFlag,
          updatedAt: now,
        })
        .where(eq(shipment.id, targetId));

      await tx
        .update(shipment)
        .set({
          status: 'cancelled',
          itemIds: [],
          mergedIntoShipmentId: targetId,
          cancelledAt: now,
          cancelReason: `Merged into ${target.code ?? targetId}`,
          updatedAt: now,
        })
        .where(eq(shipment.id, sourceId));

      return { mergedInto: target.code ?? targetId, itemCount: merged.length };
    });
  }

  private async restockingFee(tx: Database, cur: typeof shipment.$inferSelect, now: Date): Promise<number> {
    if (ShipmentService.labelRefusal(cur)) return 0;
    if (cur.fulfilmentMethod === 'show_pickup') {
      if (!cur.pickupEventId) return 0;
      const [show] = await tx
        .select({ requestDeadline: consignmentEvent.requestDeadline })
        .from(consignmentEvent)
        .where(eq(consignmentEvent.id, cur.pickupEventId))
        .limit(1);
      return show && show.requestDeadline.getTime() <= now.getTime() ? RESTOCKING_FEE_MINOR : 0;
    }
    if (cur.fulfilmentMethod === 'hand_delivery') {
      return cur.pickupFrom && cur.pickupFrom.getTime() <= now.getTime() ? RESTOCKING_FEE_MINOR : 0;
    }
    return RESTOCKING_FEE_MINOR;
  }

  async cancelFee(shipmentId: string, actor: ShipmentActor) {
    const s = await this.shipments.loadFor(shipmentId, actor);
    const restockingFeeMinor = s.status === 'rates_selected' ? await this.restockingFee(this.db, s, new Date()) : 0;
    return { restockingFeeMinor };
  }

  async cancel(shipmentId: string, actor: ShipmentActor, reason: string) {
    if (!reason?.trim()) throw AppError.validation('Say why');
    const s = await this.shipments.loadFor(shipmentId, actor);

    const cancellable: readonly string[] = ['requested', 'awaiting_payment', 'rates_selected'];
    const assertCancellable = (status: string) => {
      if (!cancellable.includes(status)) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `A shipment that is ${status.replace(/_/g, ' ')} cannot be cancelled — it is already being packed or has gone.`,
          409,
        );
      }
    };
    assertCancellable(s.status);
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!cur) throw AppError.notFound('Shipment not found');
      assertCancellable(cur.status);
      const feeMinor = cur.status === 'rates_selected' ? await this.restockingFee(tx as Database, cur, now) : 0;
      const paid = cur.status === 'rates_selected' && !cur.trackingNumber;

      if (ShipmentService.isDirect(cur)) await this.releaseDirectParcel(tx as Database, cur, actor.id);

      await this.ledger.lockWallet(s.userId, tx as Database);

      let refundedMinor = 0;
      if (paid) {
        const [row] = await tx
          .select({ total: sql<string>`coalesce(sum(${charge.amount}), 0)::text` })
          .from(charge)
          .where(
            and(
              eq(charge.referenceId, s.id),
              eq(charge.actionType, 'shipping'),
              eq(charge.status, 'settled'),
            ),
          );
        const [back] = await tx
          .select({ total: sql<string>`coalesce(sum(${ledgerRecord.amount}), 0)::text` })
          .from(ledgerRecord)
          .where(
            and(
              eq(ledgerRecord.userId, s.userId),
              eq(ledgerRecord.type, 'shipping_refund'),
              eq(ledgerRecord.referenceType, 'shipment'),
              eq(ledgerRecord.referenceId, s.id),
            ),
          );
        refundedMinor = Math.max(0, Number(row?.total ?? '0') - Number(back?.total ?? '0'));
        if (refundedMinor > 0) {
          await this.ledger.record(
            {
              userId: s.userId,
              type: 'shipping_refund',
              amount: refundedMinor,
              direction: 'credit',
              currency: cur.currency ?? DEFAULT_CURRENCY,
              referenceType: 'shipment',
              referenceId: s.id,
            },
            tx,
          );
        }
        const cover = (cur.membershipCover as AppliedShippingCover | null) ?? null;
        if (cover) await this.memberships.returnShippingCover(tx as Database, s.userId, cover);
      }

      if (feeMinor > 0) {
        const [c] = await tx
          .insert(charge)
          .values({
            userId: s.userId,
            actionType: 'shipping',
            pricingRuleSnapshot: { restockingFee: feeMinor, cancelledFrom: cur.status },
            amount: feeMinor,
            currency: s.currency ?? DEFAULT_CURRENCY,
            paymentMeans: 'wallet',
            status: 'settled',
            referenceId: s.id,
          })
          .returning({ id: charge.id });
        if (!c) throw AppError.validation('Failed to record the restocking fee');
        await this.ledger.record(
          {
            userId: s.userId,
            type: 'service_charge',
            amount: feeMinor,
            direction: 'debit',
            currency: s.currency ?? DEFAULT_CURRENCY,
            referenceType: 'charge',
            referenceId: c.id,
          },
          tx,
        );
      }

      await tx
        .update(shipment)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: reason.trim(),
          restockingFeeMinor: feeMinor,
          paymentDueAt: null,
          updatedAt: now,
        })
        .where(eq(shipment.id, shipmentId));

      await this.outbox.emit(tx, {
        aggregateType: 'shipment',
        aggregateId: shipmentId,
        eventType: 'shipment_cancelled',
        payload: {
          userId: s.userId,
          shipmentCode: s.code,
          restockingFeeMinor: feeMinor,
          refundedMinor,
          itemCount: ((s.itemIds as string[]) ?? []).length,
        },
      });

      return { status: 'cancelled' as const, restockingFeeMinor: feeMinor, refundedMinor };
    });
  }

  private async releaseDirectParcel(tx: Database, s: typeof shipment.$inferSelect, actorId: string) {
    const [booking] = await tx
      .select({ parcelId: parcelEvent.parcelId, fromStatus: parcelEvent.fromStatus, toStatus: parcelEvent.toStatus })
      .from(parcelEvent)
      .where(and(eq(parcelEvent.eventType, 'direct_shipped'), sql`${parcelEvent.metadata} ->> 'shipmentId' = ${s.id}`))
      .limit(1);
    if (!booking) return;
    const [current] = await tx.select().from(parcel).where(eq(parcel.id, booking.parcelId)).for('update').limit(1);
    if (!current || current.status !== (booking.toStatus ?? 'processed')) return;

    const restored = (booking.fromStatus ?? 'received') as typeof current.status;
    const now = new Date();
    await tx.update(parcel).set({ status: restored, processedAt: null, updatedAt: now }).where(eq(parcel.id, current.id));
    await tx.insert(parcelEvent).values({
      parcelId: current.id,
      eventType: 'direct_cancelled',
      fromStatus: current.status,
      toStatus: restored,
      actorId,
      facilityId: current.facilityId,
      notes: `Direct overnight shipment ${s.code ?? s.id} cancelled; the parcel is back at the dock, unopened`,
      metadata: { shipmentId: s.id, shipmentCode: s.code },
    });
  }
}
