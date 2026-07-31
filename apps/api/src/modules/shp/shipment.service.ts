import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { SHIPPING_ADAPTER } from '../../shared/adapters/adapters.module';
import type { ShippingAdapter, Rate } from '@bault/adapters';
import { PricingService } from '../prc/pricing.service';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { WalletService } from '../pay/wallet.service';
import { charge } from '../pay/pay.schema';
import { item } from '../cst/cst.schema';
import { newShipmentCode } from '../../shared/ids';
import { shipment } from './shp.schema';

/**
 * Shipment creation, rating, and rate selection (T105).
 *
 * Shipping cost is CARRIER-derived (the rate), plus an optional handling fee from
 * the pricing table (Principle VI). Selecting a rate auto-creates a settled
 * `shipping` charge and a ledger debit in one transaction. Rush is a flag that the
 * carrier prices into the rate.
 */
@Injectable()
export class ShipmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SHIPPING_ADAPTER) private readonly shipping: ShippingAdapter,
    private readonly pricing: PricingService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) {}

  async create(userId: string, itemIds: string[], destinationAddress: string, rush = false) {
    // PAY-10: a negative balance blocks new shipments.
    await this.wallet.assertNotBlocked(userId);
    for (const id of itemIds) {
      const [it] = await this.db.select().from(item).where(eq(item.id, id)).limit(1);
      if (!it || it.ownerId !== userId) throw AppError.forbidden(`Item ${id} is not yours`);
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, `Item ${id} is on hold`, 409);
      if (it.lifecycleState !== 'stored') throw new AppError(ErrorCode.CONFLICT, `Item ${id} must be stored`, 409);
    }
    const [created] = await this.db
      .insert(shipment)
      .values({
        code: newShipmentCode(),
        userId,
        itemIds,
        destinationAddress,
        rushFlag: rush,
        status: 'requested',
        currency: DEFAULT_CURRENCY,
      })
      .returning();
    if (!created) throw AppError.validation('Failed to create shipment');
    return created;
  }

  private async load(shipmentId: string) {
    const [s] = await this.db.select().from(shipment).where(eq(shipment.id, shipmentId)).limit(1);
    if (!s) throw AppError.notFound('Shipment not found');
    return s;
  }

  private rateRequest(s: { itemIds: unknown; rushFlag: boolean }) {
    const count = (s.itemIds as string[]).length;
    return {
      destination: { country: 'IL', postalCode: '00000' },
      items: Array.from({ length: count }, () => ({ weightGrams: 500 })),
      rush: s.rushFlag,
    };
  }

  async rates(shipmentId: string): Promise<Rate[]> {
    const s = await this.load(shipmentId);
    return this.shipping.getRates(this.rateRequest(s));
  }

  async selectRate(shipmentId: string, carrier: string, serviceLevel: string) {
    const s = await this.load(shipmentId);
    if (s.status !== 'requested' && s.status !== 'rates_selected') {
      throw new AppError(ErrorCode.CONFLICT, 'Shipment already in progress', 409);
    }
    const rates = await this.shipping.getRates(this.rateRequest(s));
    const rate = rates.find((r) => r.carrier === carrier && r.serviceLevel === serviceLevel);
    if (!rate) throw AppError.validation('Selected carrier/service not available');

    const { amount: handling, snapshot } = await this.pricing.price('shipping');
    const total = rate.costMinor + handling.amount;

    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(charge)
        .values({
          userId: s.userId,
          actionType: 'shipping',
          pricingRuleSnapshot: { carrierCost: rate.costMinor, handling: handling.amount, rule: snapshot },
          amount: total,
          currency: rate.currency,
          paymentMeans: 'wallet',
          status: 'settled',
          referenceId: shipmentId,
        })
        .returning({ id: charge.id });
      if (!c) throw AppError.validation('Failed to create shipping charge');
      await this.ledger.record(
        { userId: s.userId, type: 'service_charge', amount: total, direction: 'debit', currency: rate.currency, referenceType: 'charge', referenceId: c.id },
        tx,
      );
      await tx
        .update(shipment)
        .set({ carrier, serviceLevel, cost: total, currency: rate.currency, status: 'rates_selected', updatedAt: new Date() })
        .where(eq(shipment.id, shipmentId));
      return { status: 'rates_selected', carrier, serviceLevel, cost: total, currency: rate.currency };
    });
  }

  async track(shipmentId: string) {
    const s = await this.load(shipmentId);
    return {
      id: s.id,
      code: s.code,
      status: s.status,
      trackingNumber: s.trackingNumber,
      carrier: s.carrier,
      itemIds: (s.itemIds as string[]) ?? [],
      destinationAddress: s.destinationAddress,
    };
  }
}
