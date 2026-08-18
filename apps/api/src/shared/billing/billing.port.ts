import { Global, Module } from '@nestjs/common';
import type { Database } from '../../db/client';

/**
 * Billing seam (dependency inversion).
 *
 * INV/SHP/DIS must auto-charge billable actions (Principle VI), but the real
 * billing engine (PAY) is built in Phase 5 — AFTER intake (Phase 4). To avoid a
 * backward dependency, callers depend on this PORT. A no-op adapter is wired now
 * and REPLACED by the real PAY billing engine in Phase 5 without touching callers.
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
   *
   * `PricingService.price` has always preferred a class-specific rule over the
   * catch-all, but nothing passed a class through this port — so a rule naming
   * one could be created in the admin console and would never resolve. Carrying
   * it here is what makes per-class pricing reachable.
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

/** Temporary no-op until PAY lands (Phase 5). Logs intent so the seam is visible. */
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
