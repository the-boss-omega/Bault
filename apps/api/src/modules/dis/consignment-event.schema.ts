import { pgTable, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

export const consignmentEvent = pgTable('consignment_event', {
  id: pkId(),
  name: text('name').notNull(),
  venue: text('venue').notNull(),
  city: text('city'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  requestDeadline: timestamp('request_deadline', { withTimezone: true }).notNull(),
  capacity: integer('capacity').notNull().default(0),
  active: boolean('active').notNull().default(true),

  pickupEnabled: boolean('pickup_enabled').notNull().default(false),
  pickupCapacity: integer('pickup_capacity').notNull().default(0),
  pickupFeeMinor: integer('pickup_fee_minor').notNull().default(0),

  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
