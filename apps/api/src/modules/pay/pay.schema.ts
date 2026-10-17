import { pgEnum, pgTable, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * PAY tables. `ledger_record` is APPEND-ONLY (Principle II): the append-only
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
   * Escrow. Three types, so a statement can tell a hold, a release and a refund
   * apart. A hold is a real DEBIT: money in escrow has left the spendable
   * balance, and there is no stored balance to mark otherwise (Principle IV).
   */
  'escrow_hold',
  'escrow_release',
  'escrow_refund',
  /**
   * A card payment the cardholder took back. Its own type rather than a
   * negative `credit_topup`, so a statement can tell money arriving from money
   * taken back later, and can be reconciled.
   */
  'chargeback',
  /**
   * Giving money back: for a parcel cancelled before any label was bought, and
   * for a custom request declined after it was paid for.
   */
  'shipping_refund',
  'service_refund',
  /**
   * A payout the provider refused or returned. The money never left, so the
   * debit is reversed by this compensating credit, never by editing the debit.
   */
  'payout_reversal',
]);

export const ledgerDirection = pgEnum('ledger_direction', ['debit', 'credit']);

export const ledgerRecord = pgTable(
  'ledger_record',
  {
    id: pkId(),
    userId: text('user_id').notNull(),
    type: ledgerType('type').notNull(),
    amount: amountMinor().notNull(), // always positive; sign is carried by `direction`
    direction: ledgerDirection('direction').notNull(),
    currency: currency().notNull(),
    referenceType: text('reference_type'), // what reference_id names: 'charge', 'external_payment', 'wallet_request', 'escrow_deal', 'interest', ...
    referenceId: text('reference_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => ({
    /**
     * One interest row per account per day. The accrual job puts the UTC date
     * in `reference_id`, so a retry or an overlapping run the same day inserts
     * nothing.
     */
    interestDailyUnique: uniqueIndex('ledger_record_interest_daily_unique')
      .on(t.userId, t.referenceId)
      .where(sql`${t.type} = 'interest'`),
    /**
     * The ledger by DATE, across every account (migration 0033): what the
     * accountant's month summary and CSV export read, walking (occurred_at, id)
     * in order. `ledger_record_user_occurred_idx` (0006) serves one wallet and
     * cannot serve "everything in October".
     */
    byOccurred: index('ledger_record_occurred_idx').on(t.occurredAt, t.id),
  }),
);

export const externalPayment = pgTable('external_payment', {
  id: pkId(),
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(),
  providerRef: text('provider_ref').notNull(), // token/ref ONLY, never raw card data
  purpose: text('purpose').notNull(), // 'topup' | 'payout'
  status: text('status').notNull(),
  amount: amountMinor().notNull(),
  currency: currency().notNull(),
  /**
   * What the outside world calls this payment, when that is not `providerRef`:
   * a PayPal payout batch id, or the reference an administrator gave for a
   * payout they made by hand. Unique per provider (0031).
   */
  externalRef: text('external_ref'),
  /** The last provider event applied to this row. Unique, so one event applies once. */
  webhookEventId: text('webhook_event_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const charge = pgTable('charge', {
  id: pkId(),
  userId: text('user_id').notNull(),
  actionType: text('action_type').notNull(), // a pricing action, e.g. intake, storage, service, membership:folio
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
 * The statuses a wallet request moves through. The legal transitions are
 * defined in `wallet-request.rules.ts`. There is no `draft`: nothing saves an
 * unsubmitted request.
 *
 *   submitted → pending_review → approved → processing → completed
 *   submitted / pending_review / approved / processing → rejected
 *   submitted / pending_review → cancelled   (by the requester)
 *
 *   approved / processing → paying → completed | payout_failed   (a cash-out
 *   paid through the provider: debited first, settled when the provider says)
 */
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

/**
 * A REQUEST to move money in or out of a wallet, never the movement itself.
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
  /** A cash-out's `external_payment` row: the money on its way out. */
  payoutPaymentId: text('payout_payment_id'),
  /** What the payment is called outside Bault: a provider batch id, or a manual transfer's reference. */
  payoutReference: text('payout_reference'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Audit history for a wallet request. APPEND-ONLY, one row per state change.
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
