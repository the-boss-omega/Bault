import { pgTable, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * ADM tables: disputes (ADM-04) and storage-fee runs (VLT-04). Both are
 * admin-managed. Dashboard banners were removed platform-wide (Requirement 1.2).
 */

export const dispute = pgTable('dispute', {
  id: pkId(),
  code: text('code'), // human-facing Dispute ID, DSP-XXXXXXXX (Requirement 9.4)
  transactionId: text('transaction_id').notNull(),
  openedBy: text('opened_by').notNull(), // admin who opened it
  status: text('status').notNull().default('open'), // open | investigating | ruled | closed
  ruling: text('ruling'),
  note: text('note'),
  assignedAdminId: text('assigned_admin_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * One row per storage-fee sweep (what was charged, to whom, how much). Sweeps are
 * produced by the automatic daily worker job (Requirement 12.1) — `triggered_by`
 * carries the literal 'system' for those, since there is no manual trigger (12.2).
 */
export const storageFeeRun = pgTable('storage_fee_run', {
  id: pkId(),
  thresholdDays: integer('threshold_days').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  triggeredBy: text('triggered_by').notNull(), // 'system' for the automatic sweep
  chargedItemIds: jsonb('charged_item_ids').notNull(),
  chargedAccountIds: jsonb('charged_account_ids').notNull(),
  totalAmount: amountMinor('total_amount').notNull(),
  currency: currency().notNull(),
  createdAt: createdAt(),
});
