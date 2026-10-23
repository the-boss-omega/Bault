import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pkId, createdAt, updatedAt, amountMinor, currency } from '../../db/schema/_helpers';

export const membershipStatus = pgEnum('membership_status', [
  'active',
  'cancelling',
  'ended',
]);

export const membership = pgTable(
  'membership',
  {
    id: pkId(),
    userId: uuid('user_id').notNull(),
    tier: text('tier').notNull(),
    status: membershipStatus('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    scheduledTier: text('scheduled_tier'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    userUnique: unique('membership_user_unique').on(t.userId),
  }),
);

export const membershipPeriod = pgTable(
  'membership_period',
  {
    id: pkId(),
    membershipId: uuid('membership_id').notNull(),
    userId: uuid('user_id').notNull(),
    tier: text('tier').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    feeMinor: amountMinor('fee').notNull(),
    currency: currency().notNull(),
    pricingRuleSnapshot: jsonb('pricing_rule_snapshot'),
    consumed: jsonb('consumed').notNull().default({}),
    postageUsedMinor: amountMinor('postage_used').notNull().default(0),
    commissionWaivedOnMinor: amountMinor('commission_waived_on').notNull().default(0),
    insuredShipmentsUsed: integer('insured_shipments_used').notNull().default(0),
    renewsPeriodEnd: timestamp('renews_period_end', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    byUser: index('membership_period_user_idx').on(t.userId, t.periodStart),
    periodUnique: unique('membership_period_unique').on(t.membershipId, t.periodStart),
    renewalUnique: uniqueIndex('membership_period_renewal_unique')
      .on(t.membershipId, t.renewsPeriodEnd)
      .where(sql`${t.renewsPeriodEnd} IS NOT NULL`),
  }),
);
