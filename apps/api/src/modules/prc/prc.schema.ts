import { pgEnum, pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, amountMinor, currency } from '../../db/schema/_helpers';

/**
 * PRC pricing rules (Principle VI) — the SINGLE source of truth for prices/fees.
 * Rows are EFFECTIVE-DATED: a price change inserts a new row rather than editing
 * an old one, so completed transactions always resolve the rule that was in force
 * at their execution time (price freeze, Principle V). Admin-editable, no code change.
 */
export const pricingModel = pgEnum('pricing_model', ['fixed', 'percentage']);

/**
 * When a rule charges. `per_event` fires at the moment of the action (the classic
 * intake / marketplace-fee behaviour); the fixed-schedule options are billed by the
 * recurring worker sweeps (Requirement 14.1).
 */
export const billingTrigger = pgEnum('billing_trigger', [
  'per_event',
  'daily',
  'weekly',
  'monthly',
]);

export const pricingRule = pgTable('pricing_rule', {
  id: pkId(),
  actionType: text('action_type').notNull(), // intake|storage|service|shipping|marketplace_fee
  itemClass: text('item_class'), // null = applies to all classes (part of the rule's SCOPE)
  description: text('description'), // human-readable explanation of the rule
  parameters: jsonb('parameters'),
  model: pricingModel('model').notNull(),
  // fixed → amount in minor units; percentage → basis points (100 = 1%).
  value: amountMinor('value').notNull(),
  currency: currency().notNull(),
  // How/when the rule is billed, including fixed-schedule options.
  billingTrigger: billingTrigger('billing_trigger').notNull().default('per_event'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  updatedBy: text('updated_by'), // admin who created this rule
  createdAt: createdAt(),
});
