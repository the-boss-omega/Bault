import { pgTable, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../../db/schema/_helpers';

export const outboxMessage = pgTable('outbox_message', {
  id: pkId(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  createdAt: createdAt(),
});
