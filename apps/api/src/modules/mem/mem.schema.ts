import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * Membership (MEM): a fixed monthly fee, and what it has already covered.
 *
 *   `membership`        WHO is a member and on which tier. One row per account,
 *                       mutated in place as somebody upgrades or cancels.
 *   `membership_period` WHAT a given billing cycle covered. One row per account
 *                       per cycle, carrying the consumption counters.
 *
 * Periods are a separate table because each one is a record: the tier and fee
 * in force for that cycle stay frozen on it, the same guarantee
 * `pricing_rule_snapshot` gives every charge.
 */
export const membershipStatus = pgEnum('membership_status', [
  /** Paying, and the allowances apply. */
  'active',
  /**
   * Cancelled, but paid up to the end of the current cycle. The allowances
   * still apply until `currentPeriodEnd`, because that month is paid for.
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
    /**
     * A cheaper tier the member has asked for, taking effect at renewal. A
     * downgrade never takes a paid-for allowance away mid-cycle, so it waits
     * here and the renewal opens the next cycle on this tier.
     */
    scheduledTier: text('scheduled_tier'),
    /** Set when the member asks to stop; the cycle still runs to its end. */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    /**
     * One membership row per account, whatever its status, so "which tier am I
     * on" has one answer. Upgrades mutate the tier on this row and write a new
     * period; the history lives in `membership_period`.
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
     * A counter map rather than a row per use: the question asked is "how many
     * left", and what was used is already recoverable from the append-only
     * `charge` table.
     */
    consumed: jsonb('consumed').notNull().default({}),
    /** Carrier postage covered so far this cycle, in minor units. */
    postageUsedMinor: amountMinor('postage_used').notNull().default(0),
    /** Sale value already exempted from commission this cycle. */
    commissionWaivedOnMinor: amountMinor('commission_waived_on').notNull().default(0),
    /** Insured shipments covered so far this cycle. */
    insuredShipmentsUsed: integer('insured_shipments_used').notNull().default(0),
    /**
     * For a period the worker's renewal job opened: the end of the cycle it
     * renewed. A renewal starts at the moment it runs, so two overlapping runs
     * write different `periodStart`s; they agree on the cycle they renew, and
     * the unique index below lets only one of them charge. Null on a period
     * opened by joining or changing tier.
     */
    renewsPeriodEnd: timestamp('renews_period_end', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    byUser: index('membership_period_user_idx').on(t.userId, t.periodStart),
    /** One period row per membership per cycle: the upsert target. */
    periodUnique: unique('membership_period_unique').on(t.membershipId, t.periodStart),
    /** A cycle is renewed at most once. */
    renewalUnique: uniqueIndex('membership_period_renewal_unique')
      .on(t.membershipId, t.renewsPeriodEnd)
      .where(sql`${t.renewsPeriodEnd} IS NOT NULL`),
  }),
);
