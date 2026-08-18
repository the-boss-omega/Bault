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
  /**
   * Escrow. Three types rather than one, because they answer three different
   * questions on a statement — "why did my balance drop", "where did that
   * credit come from", "was I actually refunded".
   *
   * A hold is a real DEBIT: money in escrow has genuinely left the spendable
   * balance, which is what held means, and Bault keeps no stored balances to
   * mark otherwise (Principle IV).
   */
  'escrow_hold',
  'escrow_release',
  'escrow_refund',
  /**
   * A card payment the cardholder took back.
   *
   * Its own type rather than a negative `credit_topup`, because the two are
   * different facts: one is money arriving, the other is money being taken back
   * weeks later by somebody who is not Bault. A statement that could not tell
   * them apart would be a statement nobody could reconcile.
   */
  'chargeback',
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

/* ============================================================
   Wallet requests (cash in / cash out)
   ============================================================ */

export const walletRequestType = pgEnum('wallet_request_type', ['cash_in', 'cash_out']);

/**
 * The lifecycle a wallet request actually moves through.
 *
 * `draft` is deliberately absent: nothing in the product saves an unsubmitted
 * request, so a status with no path into it would be a lie in the enum. The
 * statuses here are exactly the ones the review process produces.
 *
 *   submitted → pending_review → approved → processing → completed
 *                             ↘ rejected
 *   submitted / pending_review → cancelled   (by the requester)
 */
export const walletRequestStatus = pgEnum('wallet_request_status', [
  'submitted',
  'pending_review',
  'approved',
  'rejected',
  'processing',
  'completed',
  'cancelled',
]);

/**
 * A REQUEST to move money in or out of a wallet — never the movement itself.
 *
 * Submitting one writes this row and nothing else: no ledger row, no balance
 * change. The wallet only moves when an authorized reviewer completes an
 * approved request, and even then the money is still recorded the one legal way,
 * as an append-only `ledger_record` (Principle IV). `settledLedgerId` is the
 * proof of that link and is what makes double-settlement detectable.
 */
export const walletRequest = pgTable('wallet_request', {
  id: pkId(),
  code: text('code').notNull(), // human-facing WR-XXXXXXXX
  userId: text('user_id').notNull(),
  type: walletRequestType('type').notNull(),
  status: walletRequestStatus('status').notNull().default('submitted'),
  amount: amountMinor().notNull(), // always positive minor units
  currency: currency().notNull(),
  /** cash_in: where the money comes from. */
  fundingSource: text('funding_source'),
  /** cash_out: where the money goes (admin-visible PII). */
  destinationAccount: text('destination_account'),
  beneficiaryName: text('beneficiary_name'),
  reference: text('reference'),
  /** Object key of an uploaded supporting document, when one was provided. */
  documentKey: text('document_key'),
  notes: text('notes'),
  /** Set when the request completes; the ledger row that actually moved money. */
  settledLedgerId: text('settled_ledger_id'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Audit history for a wallet request — APPEND-ONLY, one row per state change.
 *
 * Every transition records who did it, when, what the status was before and
 * after, and the reason where the process demands one. Registered with the
 * append-only guards, so the trail cannot be edited after the fact.
 */
export const walletRequestEvent = pgTable('wallet_request_event', {
  id: pkId(),
  requestId: text('request_id').notNull(),
  actorId: text('actor_id'), // null for system transitions
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
  destinationAccount: text('destination_account').notNull(), // admin-visible PII
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  status: text('status').notNull(), // 'requested' | 'confirmed' | 'paid' | 'failed'
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
