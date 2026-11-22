import { pgTable, text, jsonb, boolean, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { pkId, createdAt, updatedAt } from '../../db/schema/_helpers';
import { userAccount } from '../acc/acc.schema';

export const notification = pgTable('notification', {
  id: pkId(),
  userId: uuid('user_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
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
    userId: uuid('user_id').notNull().references(() => userAccount.id, { onDelete: 'restrict' }),
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
