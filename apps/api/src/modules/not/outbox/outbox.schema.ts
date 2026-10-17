import { pgTable, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';
import { pkId, createdAt } from '../../../db/schema/_helpers';

/**
 * Transactional outbox (T018).
 *
 * Domain events are written to this table INSIDE the same transaction as the
 * state change that produced them. The worker later reads and dispatches them
 * (T128), so a notification is never lost (it commits atomically with the event)
 * and never sent for a rolled-back change. Basis for Principle XI.
 */
export const outboxMessage = pgTable('outbox_message', {
  id: pkId(),
  aggregateType: text('aggregate_type').notNull(), // e.g. "item", "listing"
  aggregateId: text('aggregate_id').notNull(),
  eventType: text('event_type').notNull(), // e.g. "item_received", "item_sold"
  payload: jsonb('payload').notNull(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }), // null until worker sends it
  /**
   * How many times dispatch has failed on this message, and why, last time
   * (migration 0032). A message that throws fails alone, without stopping the
   * messages behind it; it is retried a bounded number of times, and then waits
   * here, undispatched and with its error, for a person to look at it.
   */
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  createdAt: createdAt(),
});
