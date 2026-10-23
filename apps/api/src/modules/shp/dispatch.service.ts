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

export const LABEL_PURCHASE_TIMEOUT_MS = 30_000;

const LABEL_PURCHASE_LEASE_MS = LABEL_PURCHASE_TIMEOUT_MS + 15_000;

interface LabelPurchase {
  state: 'buying' | 'unknown' | 'bought' | 'refused';
  key: string;
  startedAt: string;
  operatorId: string;
  attempts: number;
  lastError?: string;
  boughtAt?: string;
  labelCostMinor?: number;
}

interface DispatchForm {
  scannedItemIds?: string[];
  scannedParcel?: string;
  carrier: string;
  packageWeightGrams: number;
  fulfillmentNotes: string;
}

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
    if (!form.carrier || !form.fulfillmentNotes || !(form.packageWeightGrams > 0)) {
      throw AppError.validation('Fulfillment form is incomplete');
    }

    const { s, verified } = await this.claim(operatorId, shipmentId, form);

    const label = s.trackingNumber ? null : await this.buy(s, form);

    return this.complete(operatorId, s.id, form, verified, label);
  }

  private async claim(operatorId: string, shipmentId: string, form: DispatchForm) {
    return this.custody.run(async (tx) => {
      const [s] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Shipment not found');
      if (s.fulfilmentMethod !== 'carrier') {
        throw new AppError(ErrorCode.CONFLICT, 'This shipment is not going by carrier', 409);
      }
      if (s.status !== 'rates_selected' && s.status !== 'labeled') {
        throw new AppError(ErrorCode.CONFLICT, 'Shipment not ready to dispatch', 409);
      }

      const verified = await this.verifyContents(tx, s, form);

      const previous = DispatchService.purchaseOf(s);
      if (s.status === 'labeled' && previous?.state === 'buying') {
        const age = Date.now() - new Date(previous.startedAt).getTime();
        if (age < LABEL_PURCHASE_LEASE_MS) {
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
      const refused = purchaseSent && LabelNotPurchasedError.is(err);
      const nothingBought = !purchaseSent || refused;
      await this.settleFailedPurchase(s.id, nothingBought, refused, err);
      if (err instanceof AppError) throw err;
      const reason = (err as Error).message;
      throw new AppError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        refused
          ? `The carrier refused the label: ${reason}. Nothing was bought. Choose a new service for this shipment (the collector or an operator can), then dispatch again.`
          : nothingBought
            ? `The carrier did not sell a label: ${reason}. Nothing was bought, and the shipment can be dispatched again.`
            : `The carrier did not confirm the label (${reason}). It may have been bought. Dispatch again: the same purchase is repeated, and a label that exists is not bought twice.`,
        HttpStatus.BAD_GATEWAY,
        { outcome: refused ? 'refused' : nothingBought ? 'not_bought' : 'unknown' },
      );
    }
  }

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

  private async settleFailedPurchase(shipmentId: string, nothingBought: boolean, refused: boolean, err: unknown) {
    await this.custody.run(async (tx) => {
      const [cur] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!cur || cur.status !== 'labeled' || cur.trackingNumber) return;
      const purchase = DispatchService.purchaseOf(cur);
      const fulfillment = (cur.fulfillment as Record<string, unknown> | null) ?? {};
      const lastError = String((err as Error)?.message ?? err).slice(0, 300);
      if (nothingBought) {
        await tx
          .update(shipment)
          .set({
            status: 'rates_selected',
            fulfillment: refused && purchase ? { labelPurchase: { ...purchase, state: 'refused', lastError } } : null,
            packageWeightGrams: null,
            updatedAt: new Date(),
          })
          .where(eq(shipment.id, shipmentId));
        return;
      }
      await tx
        .update(shipment)
        .set({
          fulfillment: {
            ...fulfillment,
            labelPurchase: { ...purchase, state: 'unknown', lastError },
          },
          updatedAt: new Date(),
        })
        .where(eq(shipment.id, shipmentId));
    });
  }

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
        return { failed: err };
      }
    });

    if ('shipped' in outcome) return outcome.shipped;
    const err = outcome.failed;
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

  private static purchaseOf(s: Shipment): LabelPurchase | null {
    const f = s.fulfillment as { labelPurchase?: LabelPurchase } | null;
    return f?.labelPurchase ?? null;
  }

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
