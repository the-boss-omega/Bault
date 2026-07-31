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
  actionType: 'intake' | 'storage' | 'service' | 'shipping' | 'marketplace_fee';
  itemId?: string;
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
