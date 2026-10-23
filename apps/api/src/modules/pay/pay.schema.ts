import { check, pgEnum, pgTable, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

export const ledgerType = pgEnum('ledger_type', [
  'purchase',
  'sale_credit',
  'fee',
  'service_charge',
  'credit_topup',
  'withdrawal',
  'interest',
  'escrow_hold',
  'escrow_release',
  'escrow_refund',
  'chargeback',
  'shipping_refund',
  'service_refund',
  'payout_reversal',
]);

export const ledgerDirection = pgEnum('ledger_direction', ['debit', 'credit']);

export const ledgerRecord = pgTable(
  'ledger_record',
  {
    id: pkId(),
    userId: text('user_id').notNull(),
    type: ledgerType('type').notNull(),
    amount: amountMinor().notNull(),
    direction: ledgerDirection('direction').notNull(),
    currency: currency().notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => ({
    interestDailyUnique: uniqueIndex('ledger_record_interest_daily_unique')
      .on(t.userId, t.referenceId)
      .where(sql`${t.type} = 'interest'`),
    byOccurred: index('ledger_record_occurred_idx').on(t.occurredAt, t.id),
    amountPositive: check('ledger_record_amount_positive', sql`${t.amount} > 0`),
  }),
);

export const externalPayment = pgTable('external_payment', {
  id: pkId(),
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(),
  providerRef: text('provider_ref').notNull(),
  purpose: text('purpose').notNull(),
  status: text('status').notNull(),
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  externalRef: text('external_ref'),
  webhookEventId: text('webhook_event_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const charge = pgTable('charge', {
  id: pkId(),
  userId: text('user_id').notNull(),
  actionType: text('action_type').notNull(),
  pricingRuleSnapshot: jsonb('pricing_rule_snapshot').notNull(),
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  paymentMeans: text('payment_means').notNull(),
  status: text('status').notNull(),
  referenceId: text('reference_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const walletRequestType = pgEnum('wallet_request_type', ['cash_in', 'cash_out']);

export const walletRequestStatus = pgEnum('wallet_request_status', [
  'submitted',
  'pending_review',
  'approved',
  'rejected',
  'processing',
  'completed',
  'cancelled',
  'paying',
  'payout_failed',
]);

export const walletRequest = pgTable('wallet_request', {
  id: pkId(),
  code: text('code').notNull(),
  userId: text('user_id').notNull(),
  type: walletRequestType('type').notNull(),
  status: walletRequestStatus('status').notNull().default('submitted'),
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  fundingSource: text('funding_source'),
  destinationAccount: text('destination_account'),
  beneficiaryName: text('beneficiary_name'),
  reference: text('reference'),
  documentKey: text('document_key'),
  notes: text('notes'),
  settledLedgerId: text('settled_ledger_id'),
  payoutPaymentId: text('payout_payment_id'),
  payoutReference: text('payout_reference'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const walletRequestEvent = pgTable('wallet_request_event', {
  id: pkId(),
  requestId: text('request_id').notNull(),
  actorId: text('actor_id'),
  actorRole: text('actor_role'),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  reason: text('reason'),
  metadata: jsonb('metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
});

export const withdrawal = pgTable('withdrawal', {
  id: pkId(),
  userId: text('user_id').notNull(),
  destinationAccount: text('destination_account').notNull(),
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  status: text('status').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
