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

export interface BillingPort {
  charge(tx: Database, action: BillableAction): Promise<void>;
}

export const BILLING_PORT = Symbol('BILLING_PORT');

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
