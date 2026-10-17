import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { charge, ledgerRecord } from '../pay/pay.schema';
import { shipment } from './shp.schema';
import { ParcelProfileService } from './parcel-profile.service';
import { shippingBox } from './boxes';
import { ShipmentService, type ShipmentActor, type ShipmentOptionsInput } from './shipment.service';
import { MembershipService, type AppliedShippingCover } from '../mem/membership.service';
import {
  MAX_INSURED_VALUE_MINOR,
  RESTOCKING_FEE_MINOR,
  checkOptions,
  needsCustoms,
  signatureForced,
} from './shipping-options';

/**
 * Changing a shipment after it has been requested: edit, merge and cancel.
 *
 * Edits and merges are open exactly while the request still reads `requested`,
 * the point before which nobody has walked to a shelf. Once a rate is selected
 * the parcel has been paid for and an operator may be holding it, so changing
 * the contents underneath them would make it a different parcel.
 */
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

  /** Loaded, owned, and still open to change. */
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

  /**
   * Change what is in the parcel, and what has been asked for.
   *
   * Every field is optional and only what is supplied moves, so a collector
   * adding one card does not have to re-send the insurance figure and risk
   * clearing it.
   */
  async update(
    shipmentId: string,
    actor: ShipmentActor,
    patch: ShipmentOptionsInput & { itemIds?: string[]; recipientName?: string },
  ) {
    const s = await this.loadEditable(shipmentId, actor);

    const itemIds = patch.itemIds ?? ((s.itemIds as string[]) ?? []);
    const items = await this.profiles.loadShippableItems(s.userId, itemIds);
    // Everything except THIS shipment: an item already on it is not a conflict
    // with itself.
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
    // Undefined keeps the box; null lets `boxFor` pick one. The contents are
    // re-checked either way, because adding a sealed box can outgrow the mailer.
    const boxSize = patch.boxSize === undefined ? s.boxSize : patch.boxSize;
    const { box, problems: boxProblems } = this.profiles.boxFor(boxSize, items, measurements);
    if (boxProblems.length > 0) {
      throw AppError.validation(boxProblems[0]!.message, { problems: boxProblems });
    }
    // Rebuilt rather than patched: the apportionment depends on the whole item
    // set, so a stale line for a removed card would put value on a card that is
    // not in the box.
    const customsLines = needsCustoms(s.destinationCountry)
      ? this.profiles.buildCustomsLines(measurements, declaredValueMinor, patch.perItemCustomsValues)
      : null;

    const [updated] = await this.db
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
      // Still `requested`: an edit checked before a rate was chosen and paid
      // for must not land after it, or the parcel leaves holding more than was
      // charged for.
      .where(and(eq(shipment.id, shipmentId), eq(shipment.status, 'requested')))
      .returning();
    if (!updated) {
      throw new AppError(ErrorCode.CONFLICT, 'This request has moved on and can no longer be changed.', 409);
    }
    return updated;
  }

  /**
   * Fold one request into another.
   *
   * Both must belong to the same collector, both must still be `requested`, and
   * both must be going to the same place: merging two parcels bound for
   * different addresses would lose one of them.
   *
   * The absorbed request is not deleted. It keeps its code and points at its
   * new home, because a collector who wrote down SHP-1234 is entitled to find
   * out what became of it rather than meeting a 404.
   */
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

    // The combined parcel is worth the sum of its parts, and asks for the
    // stronger of the two protections. Taking the target's figures alone would
    // quietly downgrade the cover on the cards that came from the source.
    const declaredValueMinor = target.declaredValueMinor + source.declaredValueMinor;
    const insuredValueMinor = Math.min(
      target.insuredValueMinor + source.insuredValueMinor,
      // Capped rather than refused: a merge that would exceed the ceiling still
      // makes sense, it simply cannot be insured past it.
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

    // Two parcels in one box need the bigger of the two boxes. If even that
    // cannot hold the combined contents, the box is cleared and `boxFor` picks
    // one that fits when the shipment is rated.
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
      // Both still open, re-read under their locks in a fixed order, so neither
      // was paid for or merged elsewhere since the checks above.
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

  /**
   * Call it off.
   *
   * The restocking fee is charged only when work has actually been done, which
   * here means a rate was selected and paid for, so the parcel was queued for
   * picking. A request nobody has touched is free to abandon.
   *
   * What was paid for the parcel comes back. A label is bought at dispatch, and
   * a parcel that can still be cancelled has not been dispatched, so nothing was
   * spent on it but the picking the fee pays for: the shipping charge is
   * credited back as a `shipping_refund`, the membership cover it used goes back
   * to the member's cycle, and the collector is out the restocking fee and
   * nothing else. A parcel that somehow carries a tracking number is refunded
   * nothing, because then a label may really have been bought.
   */
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
      // Checked again under the lock, so two Cancel clicks cannot both charge the
      // restocking fee and a cancel cannot race a dispatch.
      const [cur] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!cur) throw AppError.notFound('Shipment not found');
      assertCancellable(cur.status);
      // Nothing was picked and nothing was paid, so nothing is owed.
      const feeMinor = cur.status === 'rates_selected' ? RESTOCKING_FEE_MINOR : 0;
      const paid = cur.status === 'rates_selected' && !cur.trackingNumber;

      // The shipment, then the wallet, then the member's cycle: the order every
      // other money path takes them in.
      await this.ledger.lockWallet(s.userId, tx as Database);

      /**
       * What the collector actually paid for this parcel, from the charges
       * themselves rather than from `cost`, so the refund is exactly what left
       * the wallet for it: the carrier rate, a white-glove quote, a show fee.
       * Less whatever was already given back on it: a cheaper rate chosen after
       * the carrier refused a label refunds its difference at that moment.
       */
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
}
