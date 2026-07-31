import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { SHIPPING_ADAPTER } from '../../shared/adapters/adapters.module';
import type { ShippingAdapter } from '@bault/adapters';
import { CustodyService } from '../cst/custody.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { shipment } from './shp.schema';

/**
 * Scan-verified dispatch (T106, Principles III & VI) — Opus-tier.
 *
 * The operator scans every item they pack; the scanned set MUST match the
 * shipment's items exactly (no missing/extra pieces). Then, in one transaction:
 * buy the label, move each item to the terminal `shipped` state with a custody
 * event, record the tracking number, and emit `shipment_out`.
 */
@Injectable()
export class DispatchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SHIPPING_ADAPTER) private readonly shipping: ShippingAdapter,
    private readonly custody: CustodyService,
    private readonly outbox: OutboxService,
  ) {}

  async dispatch(
    operatorId: string,
    shipmentId: string,
    form: {
      scannedItemIds: string[];
      carrier: string;
      packageWeightGrams: number;
      fulfillmentNotes: string;
    },
  ) {
    return this.custody.run(async (tx) => {
      const [s] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for('update').limit(1);
      if (!s) throw AppError.notFound('Shipment not found');
      if (s.status !== 'rates_selected') {
        throw new AppError(ErrorCode.CONFLICT, 'Shipment not ready to dispatch', 409);
      }
      // Required fulfillment fields must be present (Requirement 5.3).
      if (!form.carrier || !form.fulfillmentNotes || !(form.packageWeightGrams > 0)) {
        throw AppError.validation('Fulfillment form is incomplete');
      }

      // Scan/verify: EVERY item in the shipment must be verified (set equality).
      const expected = new Set(s.itemIds as string[]);
      const scanned = new Set(form.scannedItemIds);
      const matches = expected.size === scanned.size && [...expected].every((id) => scanned.has(id));
      if (!matches) {
        throw new AppError(ErrorCode.CONFLICT, 'Verified items do not match the shipment', 409, {
          expected: [...expected],
          scanned: [...scanned],
        });
      }

      const label = await this.shipping.buyLabel(
        { carrier: s.carrier!, serviceLevel: s.serviceLevel!, costMinor: s.cost ?? 0, currency: s.currency ?? 'USD', estimatedDays: 0 },
        { destination: { country: 'US', postalCode: '00000' }, items: [...expected].map(() => ({ weightGrams: form.packageWeightGrams })), rush: s.rushFlag },
      );

      for (const itemId of expected) {
        await this.custody.changeState(tx, itemId, 'shipped', operatorId, `dispatched via ${form.carrier}`);
      }

      await tx
        .update(shipment)
        .set({
          status: 'shipped',
          trackingNumber: label.trackingNumber,
          labelObjectKey: label.labelObjectKey,
          packageWeightGrams: form.packageWeightGrams,
          fulfillmentNotes: form.fulfillmentNotes,
          fulfillment: {
            carrier: form.carrier,
            packageWeightGrams: form.packageWeightGrams,
            verifiedItemIds: [...scanned],
            notes: form.fulfillmentNotes,
          },
          fulfilledBy: operatorId,
          fulfilledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(shipment.id, shipmentId));

      await this.outbox.emit(tx, {
        aggregateType: 'shipment',
        aggregateId: shipmentId,
        eventType: 'shipment_out',
        payload: {
          shipmentId,
          shipmentCode: s.code,
          userId: s.userId,
          trackingNumber: label.trackingNumber,
        },
      });

      return { status: 'shipped', trackingNumber: label.trackingNumber };
    });
  }
}
