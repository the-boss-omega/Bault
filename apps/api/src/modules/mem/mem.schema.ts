import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * Membership (MEM) — a fixed monthly fee, and what it has already covered.
 *
 * Two tables, and the split matters:
 *
 *   `membership`        WHO is a member and on which tier. One row per account,
 *                       mutated in place as somebody upgrades or cancels.
 *   `membership_period` WHAT a given billing cycle covered. Append-only, one row
 *                       per account per cycle, carrying the consumption counters.
 *
 * The second is separate rather than a JSON column on the first because it is a
 * RECORD, and records in this system are not edited into oblivion. A member who
 * asks "what did I actually get for my $199 in July" is asking for a row that
 * still exists, with the tier and the fee that were in force then frozen onto
 * it — the same guarantee `pricing_rule_snapshot` gives every charge.
 */
export const membershipStatus = pgEnum('membership_status', [
  /** Paying, and the allowances apply. */
  'active',
  /**
   * Cancelled, but paid up to the end of the current cycle.
   *
   * The allowances still apply until `currentPeriodEnd`. Somebody who cancels on
   * the 2nd has paid for the month and keeps it; taking it away at the moment of
   * cancellation would be charging for a service and then withdrawing it.
   */
  'cancelling',
  /** Over. Allowances no longer apply; nothing about the items changes. */
  'ended',
]);

export const membership = pgTable(
  'membership',
  {
    id: pkId(),
    userId: uuid('user_id').notNull(),
    /** A key from `MEMBERSHIP_TIERS`. Text, not an enum: tiers are catalogue data. */
    tier: text('tier').notNull(),
    status: membershipStatus('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** The cycle the allowances are counted against right now. */
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    /** Set when the member asks to stop; the cycle still runs to its end. */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    /**
     * One membership per account.
     *
     * Not "one ACTIVE membership" — one, full stop. A second row would make
     * "which tier am I on" a question with two answers, and every allowance
     * check would have to pick. Upgrades mutate the tier on this row and write
     * a new period; the history lives in `membership_period`.
     */
    userUnique: unique('membership_user_unique').on(t.userId),
  }),
);

export const membershipPeriod = pgTable(
  'membership_period',
  {
    id: pkId(),
    membershipId: uuid('membership_id').notNull(),
    userId: uuid('user_id').notNull(),
    /** The tier in force for THIS cycle, frozen. An upgrade opens a new period. */
    tier: text('tier').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    /** What was actually charged for this cycle, and the rule that priced it. */
    feeMinor: amountMinor('fee').notNull(),
    currency: currency().notNull(),
    pricingRuleSnapshot: jsonb('pricing_rule_snapshot'),
    /**
     * Per-action consumption this cycle: `{ intake: 3, parcel_processing: 1 }`.
     *
     * A counter map rather than a row per use. The alternative — an append-only
     * consumption log — is the more orthodox shape here and was rejected on
     * purpose: every billable action would write a second row purely to be
     * counted, and the thing anybody ever asks is "how many left", which is a
     * number. What was used is already recoverable from `charge`, which is the
     * append-only record that matters.
     */
    consumed: jsonb('consumed').notNull().default({}),
    /** Carrier postage covered so far this cycle, in minor units. */
    postageUsedMinor: amountMinor('postage_used').notNull().default(0),
    /** Sale value already exempted from commission this cycle. */
    commissionWaivedOnMinor: amountMinor('commission_waived_on').notNull().default(0),
    /** Insured shipments covered so far this cycle. */
    insuredShipmentsUsed: integer('insured_shipments_used').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    byUser: index('membership_period_user_idx').on(t.userId, t.periodStart),
    /** One period row per membership per cycle — the upsert target. */
    periodUnique: unique('membership_period_unique').on(t.membershipId, t.periodStart),
  }),
);
