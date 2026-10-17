import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { SHIPPING_ADAPTER } from '../../shared/adapters/adapters.module';
import { LabelNotPurchasedError, type LabelResult, type Rate, type ShippingAdapter } from '@bault/adapters';
import { CustodyService } from '../cst/custody.service';
import { item } from '../cst/cst.schema';
import { OutboxService } from '../not/outbox/outbox.service';
import { facility } from '../inv/facility.schema';
import { parcelEvent } from '../inv/parcel.schema';
import { shipment } from './shp.schema';
import { ShipmentService } from './shipment.service';
import { DIRECT_OVERNIGHT_FACILITY, carrierService, rateFor } from './carriers';

type Shipment = typeof shipment.$inferSelect;

/**
 * How long a label purchase may take before dispatch stops waiting.
 *
 * Stopping waiting is not the same as the purchase not happening (see
 * `buy`). It only means the operator is told, rather than left looking at a
 * spinner while a connection stays open to a carrier that has gone quiet.
 */
export const LABEL_PURCHASE_TIMEOUT_MS = 30_000;

/**
 * How long a purchase in flight keeps its claim on the shipment.
 *
 * Longer than the timeout, so a claim can only be taken over once the attempt
 * that made it has certainly given up; the one way left for a stale claim to
 * exist is a process that died mid-purchase.
 */
const LABEL_PURCHASE_LEASE_MS = LABEL_PURCHASE_TIMEOUT_MS + 15_000;

/** Where a label purchase stands, recorded on the shipment's fulfilment record. */
interface LabelPurchase {
  /**
   * `buying`: an attempt is talking to the carrier now.
   * `unknown`: an attempt ended without an answer, so the label may exist.
   * `bought`: the tracking number is on the shipment.
   */
  state: 'buying' | 'unknown' | 'bought';
  /** The purchase's idempotency key. The shipment's own id: one label per shipment. */
  key: string;
  startedAt: string;
  operatorId: string;
  attempts: number;
  lastError?: string;
  boughtAt?: string;
  labelCostMinor?: number;
}

interface DispatchForm {
  /** Exactly what was scanned at the bench: item barcodes, serials or ids. */
  scannedItemIds?: string[];
  /** For a direct-overnight shipment, the parcel that was scanned: its code or its inbound tracking number. */
  scannedParcel?: string;
  carrier: string;
  packageWeightGrams: number;
  fulfillmentNotes: string;
}

/**
 * Scan-verified dispatch (T106, Principles III & VI).
 *
 * The operator scans every item they pack; the scanned set MUST match the
 * shipment's items exactly (no missing/extra pieces). A direct-overnight
 * shipment has no items (the parcel never entered the vault), so there the
 * operator scans the parcel instead.
 *
 * THREE STEPS, because buying a label is a call to somebody else's computer
 * that spends money no rollback can return. It must not hold the shipment and
 * its cards `FOR UPDATE` while the carrier answers, and a failure after the
 * purchase must not roll back the tracking number while the label stays bought
 * (a retry would then buy a second one).
 *
 *   1. Under the locks: check the scan, check every card is still the
 *      collector's, on the shelf and not on hold, and record that a purchase is
 *      under way (`labeled`). Commit.
 *   2. No locks: buy the label, bounded by a timeout and named by the
 *      shipment's own idempotency key.
 *   3. Under the locks again: record the tracking number FIRST, then check the
 *      cards again and move them to `shipped`. If a card changed in between,
 *      the tracking number stays recorded and dispatching again finishes the
 *      job without buying anything.
 */
@Injectable()
export class DispatchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SHIPPING_ADAPTER) private readonly shipping: ShippingAdapter,
    private readonly custody: CustodyService,
    private readonly outbox: OutboxService,
    private readonly shipments: ShipmentService,
  ) {}

  async dispatch(operatorId: string, shipmentId: string, form: DispatchForm) {
    // Required fulfillment fields must be present (Requirement 5.3).
    if (!form.carrier || !form.fulfillmentNotes || !(form.packageWeightGrams > 0)) {
      throw AppError.validation('Fulfillment form is incomplete');
    }

    // 1. Under the locks: verify, and claim the shipment for this purchase.
    const { s, verified } = await this.claim(operatorId, shipmentId, form);

    // 2. With no locks held: buy, unless an earlier attempt already did.
    const label = s.trackingNumber ? null : await this.buy(s, form);

    // 3. Under the locks again: keep the label, then hand the parcel over.
    return this.complete(operatorId, s.id, form, verified, label);
  }

  /* ------------------------------------------------------------------
     1. Lock, verify, claim
     ------------------------------------------------------------------ */

  private async claim(operatorId: string, shipmentId: string, form: DispatchForm) {
    return this.custody.run(async (tx) => {
      const [s] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Shipment not found');
      // A hand-delivery or show pickup is closed by a hand-over, never by a
      // carrier label bought for a parcel nobody quoted.
      if (s.fulfilmentMethod !== 'carrier') {
        throw new AppError(ErrorCode.CONFLICT, 'This shipment is not going by carrier', 409);
      }
      // `labeled` is a dispatch that did not finish: it is picked up where it
      // stopped, never started again from the top.
      if (s.status !== 'rates_selected' && s.status !== 'labeled') {
        throw new AppError(ErrorCode.CONFLICT, 'Shipment not ready to dispatch', 409);
      }

      const verified = await this.verifyContents(tx, s, form);

      const previous = DispatchService.purchaseOf(s);
      if (s.status === 'labeled' && previous?.state === 'buying') {
        const age = Date.now() - new Date(previous.startedAt).getTime();
        if (age < LABEL_PURCHASE_LEASE_MS) {
          // Two operators at one parcel. Answered at once rather than queued
          // behind the first one's purchase, and never a second purchase.
          throw new AppError(
            ErrorCode.CONFLICT,
            'A label is being bought for this shipment right now. Wait for it to finish, then dispatch again if it did not.',
            409,
          );
        }
      }
      if (s.trackingNumber) return { s, verified };

      const purchase: LabelPurchase = {
        state: 'buying',
        key: s.id,
        startedAt: new Date().toISOString(),
        operatorId,
        attempts: (previous?.attempts ?? 0) + 1,
      };
      const [updated] = await tx
        .update(shipment)
        .set({
          status: 'labeled',
          packageWeightGrams: form.packageWeightGrams,
          fulfillment: { ...DispatchService.record(form, verified), labelPurchase: purchase },
          updatedAt: new Date(),
        })
        .where(eq(shipment.id, s.id))
        .returning();
      return { s: updated!, verified };
    });
  }

  /**
   * The scan, checked against what the shipment holds.
   *
   * Items: every one, by whatever its label says (barcode, serial or id), and
   * set-equal, no piece missing and none extra. Then each card is locked and
   * checked to still be the collector's, on the shelf and not on hold: before
   * a label is bought, not merely before it is recorded.
   *
   * Direct overnight: the parcel it was booked for, by its code or the inbound
   * tracking number on its label, still at the facility it leaves from.
   */
  private async verifyContents(
    tx: Database,
    s: Shipment,
    form: DispatchForm,
  ): Promise<{ itemIds: string[]; parcelCode: string | null }> {
    if (ShipmentService.isDirect(s)) {
      const scanned = form.scannedParcel?.trim() ?? '';
      if (!scanned) throw AppError.validation('Scan the parcel this shipment was booked for');
      const booked = (await this.shipments.directParcels([s.id], tx)).get(s.id);
      if (!booked) {
        throw new AppError(ErrorCode.CONFLICT, 'This direct shipment has no parcel on record', 409);
      }
      const matches = [booked.code, booked.trackingNumber]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toUpperCase() === scanned.toUpperCase());
      if (!matches) {
        throw new AppError(ErrorCode.CONFLICT, `That is not the parcel this shipment was booked for (${booked.code})`, 409, {
          expected: booked.code,
          scanned,
        });
      }
      const [site] = await tx.select({ code: facility.code }).from(facility).where(eq(facility.id, booked.facilityId)).limit(1);
      if (site?.code !== DIRECT_OVERNIGHT_FACILITY) {
        throw new AppError(ErrorCode.CONFLICT, `Parcel ${booked.code} is no longer at the ${DIRECT_OVERNIGHT_FACILITY} facility`, 409);
      }
      return { itemIds: [], parcelCode: booked.code };
    }

    const expected = new Set(s.itemIds as string[]);
    const scanned = await this.resolveScans(tx, form.scannedItemIds ?? []);
    const matches = expected.size === scanned.size && [...expected].every((id) => scanned.has(id));
    if (!matches) {
      throw new AppError(ErrorCode.CONFLICT, 'Verified items do not match the shipment', 409, {
        expected: [...expected],
        scanned: [...scanned],
      });
    }
    await this.custody.lockItems(tx, [...expected]);
    for (const itemId of expected) await this.custody.lockExpecting(tx, itemId, { ownerId: s.userId });
    return { itemIds: [...expected], parcelCode: null };
  }

  /**
   * Turn what the scanner produced into item ids.
   *
   * A label carries the barcode, and a person reads the serial off it; the id is
   * on no label at all. A scan that matches no item stays as it was, so it can
   * only make the set disagree; it is never quietly dropped.
   */
  private async resolveScans(tx: Database, scans: readonly string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const raw of scans) {
      const code = raw?.trim();
      if (!code) continue;
      const [row] = await tx
        .select({ id: item.id })
        .from(item)
        .where(
          or(
            sql`${item.id}::text = ${code}`,
            sql`upper(${item.barcode}) = upper(${code})`,
            sql`upper(${item.serialNumber}) = upper(${code})`,
          ),
        )
        .limit(1);
      out.add(row?.id ?? code);
    }
    return out;
  }

  /* ------------------------------------------------------------------
     2. Buy, with no locks held
     ------------------------------------------------------------------ */

  /**
   * Buy the label, and say plainly what is known when that fails.
   *
   * A refusal (the carrier answered no) means nothing was bought: the claim
   * is released and the shipment is ready to dispatch again. Any other failure
   * (a timeout, a dropped connection, a 5xx) leaves the outcome UNKNOWN: the
   * label may exist. The shipment keeps its claim, cannot be cancelled, and
   * dispatching again repeats the same purchase under the same key, which the
   * adapter answers with the label it already sold, if it sold one.
   */
  private async buy(s: Shipment, form: DispatchForm): Promise<LabelResult> {
    const signal = AbortSignal.timeout(LABEL_PURCHASE_TIMEOUT_MS);
    let purchaseSent = false;
    try {
      const { rate, request } = ShipmentService.isDirect(s)
        ? await this.shipments.directLabelRequest(s, form.packageWeightGrams)
        : await this.shipments.labelRequest(s, form.packageWeightGrams);
      const buyable = ShipmentService.isDirect(s) ? await this.directRate(s, rate, request, signal) : rate;
      purchaseSent = true;
      return await this.shipping.buyLabel(buyable, request, { idempotencyKey: s.id, signal });
    } catch (err) {
      const nothingBought = !purchaseSent || LabelNotPurchasedError.is(err);
      await this.settleFailedPurchase(s.id, nothingBought, err);
      if (err instanceof AppError) throw err;
      const reason = (err as Error).message;
      throw new AppError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        nothingBought
          ? `The carrier did not sell a label: ${reason}. Nothing was bought, and the shipment can be dispatched again.`
          : `The carrier did not confirm the label (${reason}). It may have been bought. Dispatch again: the same purchase is repeated, and a label that exists is not bought twice.`,
        HttpStatus.BAD_GATEWAY,
        { outcome: nothingBought ? 'not_bought' : 'unknown' },
      );
    }
  }

  /**
   * What a direct-overnight label is bought against.
   *
   * The collector paid a flat price; nobody quoted a carrier. A real carrier
   * sells only a rate it quoted, so the parcel is rated now and the overnight
   * service's own rate is the one bought. Its handles are written to the
   * shipment BEFORE the purchase, so a retry buys against the same carrier
   * shipment (whose single label the adapter returns) instead of rating, and
   * paying for, a new one.
   */
  private async directRate(s: Shipment, charged: Rate, request: Parameters<ShippingAdapter['getRates']>[0], signal: AbortSignal) {
    if (charged.providerShipmentId && charged.providerRateId) return charged;
    const service = carrierService(s.serviceKey ?? '');
    const quoted = service ? rateFor(service, await this.shipping.getRates(request, { signal })) : undefined;
    if (!service || !quoted) {
      throw new LabelNotPurchasedError('the carrier offers no overnight service for this parcel');
    }
    if (quoted.providerShipmentId && quoted.providerRateId) {
      await this.db
        .update(shipment)
        .set({ providerShipmentId: quoted.providerShipmentId, providerRateId: quoted.providerRateId, updatedAt: new Date() })
        .where(and(eq(shipment.id, s.id), eq(shipment.status, 'labeled'), isNull(shipment.providerRateId)));
    }
    return { ...quoted, carrier: charged.carrier, serviceLevel: charged.serviceLevel };
  }

  private async settleFailedPurchase(shipmentId: string, nothingBought: boolean, err: unknown) {
    await this.custody.run(async (tx) => {
      const [cur] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!cur || cur.status !== 'labeled' || cur.trackingNumber) return;
      const purchase = DispatchService.purchaseOf(cur);
      const fulfillment = (cur.fulfillment as Record<string, unknown> | null) ?? {};
      if (nothingBought) {
        // Back to where it was: paid for, ready to go, cancellable.
        await tx
          .update(shipment)
          .set({ status: 'rates_selected', fulfillment: null, packageWeightGrams: null, updatedAt: new Date() })
          .where(eq(shipment.id, shipmentId));
        return;
      }
      await tx
        .update(shipment)
        .set({
          fulfillment: {
            ...fulfillment,
            labelPurchase: { ...purchase, state: 'unknown', lastError: String((err as Error)?.message ?? err).slice(0, 300) },
          },
          updatedAt: new Date(),
        })
        .where(eq(shipment.id, shipmentId));
    });
  }

  /* ------------------------------------------------------------------
     3. Record the label, then ship
     ------------------------------------------------------------------ */

  /**
   * One transaction: the tracking number first, then the cards.
   *
   * The tracking number is written before anything that can fail, and the
   * hand-off itself runs in a savepoint inside the same transaction. If a card
   * changed hands, went on hold or left the shelf while the label was being
   * bought, the hand-off is rolled back to the savepoint and the transaction
   * still commits, so the only record of a label somebody paid for is never
   * taken back with it, and dispatching again finishes the job without buying
   * anything.
   */
  private async complete(
    operatorId: string,
    shipmentId: string,
    form: DispatchForm,
    verified: { itemIds: string[]; parcelCode: string | null },
    label: LabelResult | null,
  ) {
    const outcome = await this.custody.run(async (tx) => {
      const [s] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Shipment not found');
      if (s.status !== 'labeled') {
        throw new AppError(ErrorCode.CONFLICT, 'Shipment not ready to dispatch', 409);
      }

      let trackingNumber = s.trackingNumber;
      let fulfillment = (s.fulfillment as Record<string, unknown> | null) ?? {};
      if (!trackingNumber) {
        if (!label) throw new AppError(ErrorCode.CONFLICT, 'Shipment not ready to dispatch', 409);
        trackingNumber = label.trackingNumber;
        fulfillment = {
          ...fulfillment,
          labelPurchase: {
            ...DispatchService.purchaseOf(s),
            state: 'bought',
            boughtAt: new Date().toISOString(),
            labelCostMinor: label.costMinor,
          },
        };
        await tx
          .update(shipment)
          .set({ trackingNumber, labelObjectKey: label.labelObjectKey, fulfillment, updatedAt: new Date() })
          .where(eq(shipment.id, shipmentId));
      }

      try {
        return await tx.transaction(async (sp) => {
          // The same ownership check as before the purchase, again under the
          // locks: a card sold, held or moved since then does not leave.
          await this.custody.lockItems(sp, verified.itemIds);
          for (const itemId of verified.itemIds) {
            await this.custody.lockExpecting(sp, itemId, { ownerId: s.userId });
          }
          for (const itemId of verified.itemIds) {
            await this.custody.changeState(sp, itemId, 'shipped', operatorId, `dispatched via ${form.carrier}`);
          }

          if (ShipmentService.isDirect(s)) {
            const booked = (await this.shipments.directParcels([s.id], sp)).get(s.id);
            if (booked) {
              // The parcel's trail says where it went, as it says everything else.
              await sp.insert(parcelEvent).values({
                parcelId: booked.id,
                eventType: 'direct_dispatched',
                fromStatus: booked.status,
                toStatus: booked.status,
                actorId: operatorId,
                facilityId: booked.facilityId,
                notes: `Left overnight via ${form.carrier}, tracking ${trackingNumber}`,
                metadata: { shipmentId: s.id, shipmentCode: s.code, trackingNumber },
              });
            }
          }

          await sp
            .update(shipment)
            .set({
              status: 'shipped',
              packageWeightGrams: form.packageWeightGrams,
              fulfillmentNotes: form.fulfillmentNotes,
              fulfillment: { ...fulfillment, ...DispatchService.record(form, verified) },
              fulfilledBy: operatorId,
              fulfilledAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(shipment.id, shipmentId));

          await this.outbox.emit(sp, {
            aggregateType: 'shipment',
            aggregateId: shipmentId,
            eventType: 'shipment_out',
            payload: { shipmentId, shipmentCode: s.code, userId: s.userId, trackingNumber },
          });

          return { shipped: { status: 'shipped' as const, trackingNumber: trackingNumber! } };
        });
      } catch (err) {
        // Rolled back to the savepoint; the tracking number above commits.
        return { failed: err };
      }
    });

    if ('shipped' in outcome) return outcome.shipped;
    const err = outcome.failed;
    // The label is bought and recorded; only the hand-off failed. Said so, so
    // nobody buys another one to "fix" it.
    if (err instanceof AppError && err.getStatus() === 409) {
      throw new AppError(
        err.code,
        `${err.message} The label is already bought and kept on the shipment — resolve this and dispatch again; no second label will be bought.`,
        409,
        err.details,
      );
    }
    throw err;
  }

  /* ------------------------------------------------------------------ */

  private static purchaseOf(s: Shipment): LabelPurchase | null {
    const f = s.fulfillment as { labelPurchase?: LabelPurchase } | null;
    return f?.labelPurchase ?? null;
  }

  /** The fulfilment record the warehouse closes a shipment with (Requirement 5.3). */
  private static record(form: DispatchForm, verified: { itemIds: string[]; parcelCode: string | null }) {
    return {
      carrier: form.carrier,
      packageWeightGrams: form.packageWeightGrams,
      verifiedItemIds: verified.itemIds,
      ...(verified.parcelCode ? { verifiedParcelCode: verified.parcelCode } : {}),
      scanned: form.scannedItemIds ?? (form.scannedParcel ? [form.scannedParcel] : []),
      notes: form.fulfillmentNotes,
    };
  }
}
