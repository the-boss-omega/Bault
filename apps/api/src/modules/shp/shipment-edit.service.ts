import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { charge } from '../pay/pay.schema';
import { shipment } from './shp.schema';
import { ParcelProfileService } from './parcel-profile.service';
import { shippingBox } from './boxes';
import { ShipmentService, type ShipmentActor, type ShipmentOptionsInput } from './shipment.service';
import {
  MAX_INSURED_VALUE_MINOR,
  RESTOCKING_FEE_MINOR,
  checkOptions,
  needsCustoms,
  signatureForced,
} from './shipping-options';

/**
 * Changing a shipment after it has been requested.
 *
 * Everything here answers the same complaint from the audit:
 *
 * > Once `POST /shipping/shipments` returns, the item set is frozen. There is no
 * > PATCH, no merge, no cancel [...] A mistake is permanent.
 *
 * The rule that makes all three safe is the same one ShipMyCards uses: the
 * window is open exactly while the request still reads `requested`. That is not
 * an arbitrary cutoff — it is the point before which nobody has walked to a
 * shelf. Once a rate is selected the parcel has been paid for and an operator
 * may be holding it, so changing the contents underneath them is not an edit,
 * it is a different parcel.
 */
@Injectable()
export class ShipmentEditService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly shipments: ShipmentService,
    private readonly profiles: ParcelProfileService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
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
    // Undefined keeps the box; null clears it. The contents are re-checked either
    // way, because adding a sealed box to a parcel can outgrow the mailer.
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
      .where(eq(shipment.id, shipmentId))
      .returning();
    if (!updated) throw AppError.validation('Failed to update the shipment');
    return updated;
  }

  /**
   * Fold one request into another.
   *
   * Both must belong to the same collector, both must still be `requested`, and
   * both must be going to the same place — merging two parcels bound for
   * different addresses is not a merge, it is losing one of them.
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

    // Two parcels in one box need the bigger of the two boxes — and if even that
    // cannot hold the combined contents, nobody has chosen a box that works, so
    // the choice goes back to the warehouse rather than being priced on a lie.
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
   * The restocking fee is charged only when work has actually been done — which
   * here means a rate was selected and paid for, so the parcel was queued for
   * picking. A request nobody has touched is free to abandon, and charging $25
   * for changing your mind thirty seconds after clicking would be indefensible.
   *
   * The carrier cost is NOT refunded automatically. Postage that has been bought
   * has been bought; what is refunded is the part Bault has not spent, and
   * deciding that is a support conversation rather than a rule this can compute.
   */
  async cancel(shipmentId: string, actor: ShipmentActor, reason: string) {
    if (!reason?.trim()) throw AppError.validation('Say why');
    const s = await this.shipments.loadFor(shipmentId, actor);

    const cancellable: readonly string[] = ['requested', 'awaiting_payment', 'rates_selected'];
    if (!cancellable.includes(s.status)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `A shipment that is ${s.status.replace(/_/g, ' ')} cannot be cancelled — it is already being packed or has gone.`,
        409,
      );
    }

    // Nothing was picked and nothing was paid, so nothing is owed.
    const feeMinor = s.status === 'rates_selected' ? RESTOCKING_FEE_MINOR : 0;
    const now = new Date();

    return this.db.transaction(async (tx) => {
      if (feeMinor > 0) {
        const [c] = await tx
          .insert(charge)
          .values({
            userId: s.userId,
            actionType: 'shipping',
            pricingRuleSnapshot: { restockingFee: feeMinor, cancelledFrom: s.status },
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
          itemCount: ((s.itemIds as string[]) ?? []).length,
        },
      });

      return { status: 'cancelled' as const, restockingFeeMinor: feeMinor };
    });
  }
}
