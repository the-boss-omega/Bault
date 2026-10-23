export const JobName = {
  OUTBOX_DISPATCH: 'outbox.dispatch',
  STORAGE_FEE_RUN: 'storage-fee.run',
  INTEREST_ACCRUAL: 'interest.accrual',
  WALLET_SUSPENSION: 'wallet.suspension-sweep',
  TRACKING_REFRESH: 'shipment.tracking-refresh',
  LEDGER_INVARIANT_CHECK: 'ledger.invariant-check',
  IMAGE_SYNC: 'image.sync',
  SHIPMENT_EXPIRY: 'shipment.expiry-sweep',
  MEMBERSHIP_RENEWAL: 'membership.renewal',
  SESSION_CLEANUP: 'session.cleanup',
} as const;

export type JobName = (typeof JobName)[keyof typeof JobName];
