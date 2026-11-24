import { pgTable, text, integer, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';
import { transaction } from '../mkt/mkt.schema';

export const dispute = pgTable('dispute', {
  id: pkId(),
  code: text('code'),
  transactionId: uuid('transaction_id').notNull().references(() => transaction.id, { onDelete: 'restrict' }),
  openedBy: uuid('opened_by').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('open'),
  ruling: text('ruling'),
  note: text('note'),
  assignedAdminId: uuid('assigned_admin_id').references(() => userAccount.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const storageFeeRun = pgTable('storage_fee_run', {
  id: pkId(),
  thresholdDays: integer('threshold_days').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  triggeredBy: text('triggered_by').notNull(),
  chargedItemIds: jsonb('charged_item_ids').notNull(),
  chargedAccountIds: jsonb('charged_account_ids').notNull(),
  totalAmount: amountMinor('total_amount').notNull(),
  currency: currency().notNull(),
  createdAt: createdAt(),
});

export const storageCover = pgTable('storage_cover', {
  itemId: uuid('item_id').references(() => item.id, { onDelete: 'restrict' }).primaryKey(),
  coveredUntil: timestamp('covered_until', { withTimezone: true }).notNull(),
});
