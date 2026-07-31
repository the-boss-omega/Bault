import { pgTable, text, jsonb, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

/**
 * NOT tables (NOT-01/NOT-02).
 *
 * `notification` is the per-user in-app feed: each row is one delivered event
 * (written by the worker's outbox dispatch job). `notification_preference` lets a
 * user opt OUT of an event type — absence of a row means enabled (default true).
 */
export const notification = pgTable('notification', {
  id: pkId(),
  userId: text('user_id').notNull(),
  eventType: text('event_type').notNull(), // e.g. "item_received", "hold_placed"
  content: jsonb('content').notNull(), // the domain-event payload
  channel: text('channel').notNull().default('in_app'),
  status: text('status').notNull().default('sent'),
  createdAt: createdAt(),
});

export const notificationPreference = pgTable(
  'notification_preference',
  {
    id: pkId(),
    userId: text('user_id').notNull(),
    eventType: text('event_type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    // One preference row per user + event type (upserted by setPreference).
    userEventUnique: uniqueIndex('notification_preference_user_event_unique').on(t.userId, t.eventType),
  }),
);
