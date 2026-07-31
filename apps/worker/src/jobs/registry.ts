/**
 * Job name constants (T019). Centralizes pg-boss queue names so producers (the
 * API, via pg-boss) and consumers (worker jobs added in later phases) agree on
 * one string. Each name maps to a scheduled/queued job registered in index.ts.
 */
export const JobName = {
  OUTBOX_DISPATCH: 'outbox.dispatch', // T128
  STORAGE_FEE_RUN: 'storage-fee.run', // T120
  INTEREST_ACCRUAL: 'interest.accrual', // T069
  TRACKING_REFRESH: 'shipment.tracking-refresh', // T107
  LEDGER_INVARIANT_CHECK: 'ledger.invariant-check', // T070
  IMAGE_SYNC: 'image.sync', // T133
} as const;

export type JobName = (typeof JobName)[keyof typeof JobName];
