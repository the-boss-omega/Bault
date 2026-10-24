import { Global, Module } from '@nestjs/common';
import type { Database } from '../../db/client';

export interface BillableAction {
  userId: string;
  actionType:
    | 'intake'
    | 'storage'
    | 'service'
    | 'shipping'
    | 'marketplace_fee'
    | 'parcel_processing'
    | 'parcel_forwarding';
  itemId?: string;
  itemClass?: string;
  feeActionType?: string;
  metadata?: Record<string, unknown>;
}

export type ChargeOutcome =
  | { kind: 'charged'; chargeId: string; amountMinor: number; currency: string }
  | { kind: 'covered'; periodId: string; allowance: string }
  | { kind: 'free' };

export interface BillingPort {
  charge(tx: Database, action: BillableAction): Promise<ChargeOutcome>;
}

export const BILLING_PORT = Symbol('BILLING_PORT');

class NoopBillingAdapter implements BillingPort {
  async charge(_tx: Database, action: BillableAction): Promise<ChargeOutcome> {
    // eslint-disable-next-line no-console
    console.log(`[billing:noop] would charge ${action.actionType} for user ${action.userId}`);
    return { kind: 'free' };
  }
}

@Global()
@Module({
  providers: [{ provide: BILLING_PORT, useFactory: () => new NoopBillingAdapter() }],
  exports: [BILLING_PORT],
})
export class BillingModule {}
