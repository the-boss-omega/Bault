import { pgTable, text, jsonb, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';

export const notification = pgTable('notification', {
  id: pkId(),
  userId: text('user_id').notNull(),
  eventType: text('event_type').notNull(),
  content: jsonb('content').notNull(),
  channel: text('channel').notNull().default('in_app'),
  status: text('status').notNull().default('sent'),
  providerRef: text('provider_ref'),
  failureReason: text('failure_reason'),
  createdAt: createdAt(),
});

export const notificationPreference = pgTable(
  'notification_preference',
  {
    id: pkId(),
    userId: text('user_id').notNull(),
    eventType: text('event_type').notNull(),
    channel: text('channel').notNull().default('in_app'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    userEventChannelUnique: uniqueIndex('notification_preference_user_event_channel_unique').on(
      t.userId,
      t.eventType,
      t.channel,
    ),
  }),
);
