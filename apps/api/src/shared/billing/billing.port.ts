import { Global, Module } from '@nestjs/common';
import type { Database } from '../../db/client';

/**
 * Billing seam (dependency inversion).
 *
 * INV/DIS/MKT auto-charge billable actions (Principle VI) through this PORT
 * rather than depending on PAY directly. PayModule provides the real
 * implementation under BILLING_PORT.
 */
export interface BillableAction {
  userId: string;
  actionType:
    | 'intake'
    | 'storage'
    | 'service'
    | 'shipping'
    | 'marketplace_fee'
    /** Per-package fee, charged once when an inbound parcel is closed out. */
    | 'parcel_processing'
    /** The second leg, charged only to parcels sent to a forwarding address. */
    | 'parcel_forwarding';
  itemId?: string;
  /**
   * The item's class, when the action is about a specific thing.
   * `PricingService.price` prefers a class-specific rule over the catch-all,
   * so this is what lets a per-class rule apply.
   */
  itemClass?: string;
  /**
   * A more specific pricing action to try first, falling back to `actionType`.
   *
   * Grading tiers are the reason: `service` is the right CATEGORY of charge for
   * one, but the wrong price, because a five-day turnaround on a $5,000 card and
   * a six-week one on a common are not the same work. A caller that knows a
   * narrower rule names it here.
   */
  feeActionType?: string;
  metadata?: Record<string, unknown>;
}

export interface BillingPort {
  /** Create a Charge for a billable action, inside the caller's transaction. */
  charge(tx: Database, action: BillableAction): Promise<void>;
}

export const BILLING_PORT = Symbol('BILLING_PORT');

/**
 * No-op adapter that only logs. AppModule does not import BillingModule;
 * PayModule provides BILLING_PORT.
 */
class NoopBillingAdapter implements BillingPort {
  async charge(_tx: Database, action: BillableAction): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[billing:noop] would charge ${action.actionType} for user ${action.userId}`);
  }
}

@Global()
@Module({
  providers: [{ provide: BILLING_PORT, useFactory: () => new NoopBillingAdapter() }],
  exports: [BILLING_PORT],
})
export class BillingModule {}
