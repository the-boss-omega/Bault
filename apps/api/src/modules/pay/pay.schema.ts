import { pgEnum, pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * PAY tables. `ledger_record` is APPEND-ONLY (Principle II) — the append-only
 * guards installed in 0001_append_only.sql attach to it automatically on the next
 * migrate. The wallet balance is DERIVED from these rows (Principle IV); there is
 * no stored-balance table.
 */
export const ledgerType = pgEnum('ledger_type', [
  'purchase',
  'sale_credit',
  'fee',
  'service_charge',
  'credit_topup',
  'withdrawal',
  'interest',
]);

export const ledgerDirection = pgEnum('ledger_direction', ['debit', 'credit']);

export const ledgerRecord = pgTable('ledger_record', {
  id: pkId(),
  userId: text('user_id').notNull(),
  type: ledgerType('type').notNull(),
  amount: amountMinor().notNull(), // always positive; sign is carried by `direction`
  direction: ledgerDirection('direction').notNull(),
  currency: currency().notNull(),
  referenceType: text('reference_type'), // 'charge' | 'transaction' | 'withdrawal' | 'external_payment'
  referenceId: text('reference_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const externalPayment = pgTable('external_payment', {
  id: pkId(),
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(),
  providerRef: text('provider_ref').notNull(), // token/ref ONLY — never raw card data
  purpose: text('purpose').notNull(), // 'topup' | 'charge' | 'payout'
  status: text('status').notNull(),
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  webhookEventId: text('webhook_event_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const charge = pgTable('charge', {
  id: pkId(),
  userId: text('user_id').notNull(),
  actionType: text('action_type').notNull(), // intake|storage|service|shipping|marketplace_fee
  pricingRuleSnapshot: jsonb('pricing_rule_snapshot').notNull(), // exact pricing applied
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  paymentMeans: text('payment_means').notNull(), // 'wallet' | 'external'
  status: text('status').notNull(), // 'pending' | 'settled' | 'failed'
  referenceId: text('reference_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const withdrawal = pgTable('withdrawal', {
  id: pkId(),
  userId: text('user_id').notNull(),
  destinationAccount: text('destination_account').notNull(), // admin-visible PII
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  status: text('status').notNull(), // 'requested' | 'confirmed' | 'paid' | 'failed'
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
