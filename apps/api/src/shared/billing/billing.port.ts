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
