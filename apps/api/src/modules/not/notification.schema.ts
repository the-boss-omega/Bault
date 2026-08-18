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
  /** `in_app` or `email`. One row per channel a message was delivered on. */
  channel: text('channel').notNull().default('in_app'),
  /**
   * `sent` or `failed`. Both columns existed from the start and only ever held
   * one value each, because in-app delivery cannot fail — writing the row IS
   * the delivery. Email can, and a mail that bounced has to be visible as a
   * mail that bounced rather than as silence.
   */
  status: text('status').notNull().default('sent'),
  /** The provider's own id for an email, so a delivery can be traced. */
  providerRef: text('provider_ref'),
  /** Why an email failed, when it did. Null on every in-app row. */
  failureReason: text('failure_reason'),
  createdAt: createdAt(),
});

export const notificationPreference = pgTable(
  'notification_preference',
  {
    id: pkId(),
    userId: text('user_id').notNull(),
    eventType: text('event_type').notNull(),
    /**
     * Which channel this row governs.
     *
     * The preference used to be one boolean per event type, which was fine
     * while there was exactly one channel. With email it is not: "tell me when
     * something sells, but not by email" is the single most common thing anyone
     * wants to say about notifications, and one boolean cannot express it.
     */
    channel: text('channel').notNull().default('in_app'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    // One preference row per user + event type + channel.
    userEventChannelUnique: uniqueIndex('notification_preference_user_event_channel_unique').on(
      t.userId,
      t.eventType,
      t.channel,
    ),
  }),
);
