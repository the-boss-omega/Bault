import { pgEnum, pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, amountMinor, currency } from '../../db/schema/_helpers';

export const pricingModel = pgEnum('pricing_model', ['fixed', 'percentage']);

export const billingTrigger = pgEnum('billing_trigger', [
  'per_event',
  'daily',
  'weekly',
  'monthly',
]);

export const pricingRule = pgTable('pricing_rule', {
  id: pkId(),
  actionType: text('action_type').notNull(),
  itemClass: text('item_class'),
  description: text('description'),
  parameters: jsonb('parameters'),
  model: pricingModel('model').notNull(),
  value: amountMinor('value').notNull(),
  currency: currency().notNull(),
  billingTrigger: billingTrigger('billing_trigger').notNull().default('per_event'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
});
