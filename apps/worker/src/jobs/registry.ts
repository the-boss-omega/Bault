/**
 * pg-boss queue names for the worker's scheduled jobs, registered in index.ts.
 * `IMAGE_SYNC` has no handler in the worker. The API's health controller
 * mirrors `OUTBOX_DISPATCH` by value.
 */
export const JobName = {
  OUTBOX_DISPATCH: 'outbox.dispatch',
  STORAGE_FEE_RUN: 'storage-fee.run',
  INTEREST_ACCRUAL: 'interest.accrual',
  WALLET_SUSPENSION: 'wallet.suspension-sweep', // debt threshold → suspend / reinstate
  TRACKING_REFRESH: 'shipment.tracking-refresh',
  LEDGER_INVARIANT_CHECK: 'ledger.invariant-check',
  IMAGE_SYNC: 'image.sync',
  SHIPMENT_EXPIRY: 'shipment.expiry-sweep', // unpaid shipments release their items
  MEMBERSHIP_RENEWAL: 'membership.renewal', // a cycle ends: renew and charge, or end it
  SESSION_CLEANUP: 'session.cleanup', // sign-in sessions a month past their expiry are deleted
} as const;

export type JobName = (typeof JobName)[keyof typeof JobName];
