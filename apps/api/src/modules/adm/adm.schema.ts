import { pgTable, text, integer, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * ADM tables: disputes, storage-fee runs, and the storage cover the sweep
 * records.
 */

export const dispute = pgTable('dispute', {
  id: pkId(),
  code: text('code'), // human-facing Dispute ID, DSP-XXXXXXXX
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
 * produced by the automatic daily worker job, which writes `triggered_by` as the
 * literal 'system'; there is no manual trigger.
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

/**
 * When a membership last covered each item's storage. Written only by the
 * storage sweep, once a night, for every item a membership allowance covers.
 *
 * The sweep counts an item's chargeable periods from its included window or
 * from here, whichever is later, so periods spent covered are never billed
 * when the cover ends.
 */
export const storageCover = pgTable('storage_cover', {
  itemId: uuid('item_id').primaryKey(),
  coveredUntil: timestamp('covered_until', { withTimezone: true }).notNull(),
});
