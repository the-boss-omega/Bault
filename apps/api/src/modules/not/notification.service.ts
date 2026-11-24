import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { notification, notificationPreference } from './notification.schema';
import {
  EVENT_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  defaultEnabled,
  isKnownChannel,
  isKnownEventType,
  isMandatory,
} from './event-types';

export const FEED_PAGE_DEFAULT = 50;
export const FEED_PAGE_MAX = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLLECTOR_CONTENT_KEY = /^(message|barcode|code|trackingNumber|amount|price)$|Code$|Minor$/;

function collectorContent(content: unknown): Record<string, string | number> {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return {};
  const kept: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(content as Record<string, unknown>)) {
    if (!COLLECTOR_CONTENT_KEY.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) kept[key] = value;
    if (typeof value === 'string' && !UUID.test(value)) kept[key] = value;
  }
  return kept;
}

function collectorNotificationView(row: typeof notification.$inferSelect) {
  return {
    id: row.id,
    eventType: row.eventType,
    createdAt: row.createdAt,
    content: collectorContent(row.content),
  };
}

@Injectable()
export class NotificationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async listMine(userId: string, page: { limit?: number; before?: string } = {}) {
    const conditions: SQL[] = [eq(notification.userId, userId), eq(notification.channel, 'in_app')];
    if (page.before) {
      conditions.push(
        sql`(${notification.createdAt}, ${notification.id}) < (
          select n.created_at, n.id from notification n where n.id = ${page.before} and n.user_id = ${userId}
        )`,
      );
    }
    const rows = await this.db
      .select()
      .from(notification)
      .where(and(...conditions))
      .orderBy(sql`${notification.createdAt} desc`, sql`${notification.id} desc`)
      .limit(page.limit ?? FEED_PAGE_DEFAULT);
    return rows.map(collectorNotificationView);
  }

  async getPreferences(userId: string) {
    const rows = await this.db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, userId));

    const chosen = new Map(rows.map((r) => [`${r.eventType}:${r.channel}`, r.enabled]));

    const matrix = NOTIFICATION_EVENT_TYPES.map((event) => ({
      eventType: event.key,
      category: event.category,
      label: event.label,
      channels: NOTIFICATION_CHANNELS.map((channel) => {
        const explicit = chosen.get(`${event.key}:${channel}`);
        return {
          channel,
          enabled: explicit ?? defaultEnabled(event.key, channel),
          isDefault: explicit === undefined,
          mandatory: isMandatory(event.key, channel),
        };
      }),
    }));

    return { categories: EVENT_CATEGORIES, channels: NOTIFICATION_CHANNELS, events: matrix };
  }

  async setPreference(userId: string, eventType: string, channel: string, enabled: boolean) {
    if (!isKnownChannel(channel)) throw AppError.validation(`Unknown channel "${channel}"`);
    if (!isKnownEventType(eventType)) throw AppError.validation(`Unknown event type "${eventType}"`);
    if (!enabled && isMandatory(eventType, channel)) {
      throw AppError.validation(
        'This notice cannot be turned off: we must tell you when something of yours arrives damaged or cannot be accepted.',
      );
    }

    const [saved] = await this.db
      .insert(notificationPreference)
      .values({ userId, eventType, channel, enabled })
      .onConflictDoUpdate({
        target: [notificationPreference.userId, notificationPreference.eventType, notificationPreference.channel],
        set: { enabled, updatedAt: new Date() },
      })
      .returning({
        eventType: notificationPreference.eventType,
        channel: notificationPreference.channel,
        enabled: notificationPreference.enabled,
      });
    if (!saved) throw AppError.validation('Failed to save preference');
    return saved;
  }

  async setChannel(userId: string, channel: string, enabled: boolean) {
    if (!isKnownChannel(channel)) throw AppError.validation(`Unknown channel "${channel}"`);
    const events = NOTIFICATION_EVENT_TYPES.filter((event) => enabled || !isMandatory(event.key, channel));
    if (events.length > 0) {
      await this.db
        .insert(notificationPreference)
        .values(events.map((event) => ({ userId, eventType: event.key, channel, enabled })))
        .onConflictDoUpdate({
          target: [notificationPreference.userId, notificationPreference.eventType, notificationPreference.channel],
          set: { enabled, updatedAt: new Date() },
        });
    }
    return { channel, enabled, changed: events.length };
  }
}
