import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
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
  type NotificationChannel,
} from './event-types';

@Injectable()
export class NotificationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listMine(userId: string) {
    return this.db
      .select()
      .from(notification)
      .where(eq(notification.userId, userId))
      .orderBy(sql`${notification.createdAt} desc`);
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

    return { categories: EVENT_CATEGORIES, channels: NOTIFICATION_CHANNELS, events: matrix, rows };
  }

  async setPreference(userId: string, eventType: string, channel: string, enabled: boolean) {
    if (!isKnownChannel(channel)) throw AppError.validation(`Unknown channel "${channel}"`);
    if (!isKnownEventType(eventType)) throw AppError.validation(`Unknown event type "${eventType}"`);
    if (!enabled && isMandatory(eventType, channel)) {
      throw AppError.validation(
        'This one cannot be switched off. It only fires when something of yours did not survive contact with the warehouse, and you are entitled to be told.',
      );
    }

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(notificationPreference)
        .where(
          and(
            eq(notificationPreference.userId, userId),
            eq(notificationPreference.eventType, eventType),
            eq(notificationPreference.channel, channel),
          ),
        )
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(notificationPreference)
          .set({ enabled, updatedAt: new Date() })
          .where(eq(notificationPreference.id, existing.id))
          .returning();
        if (!updated) throw AppError.validation('Failed to update preference');
        return updated;
      }

      const [created] = await tx
        .insert(notificationPreference)
        .values({ userId, eventType, channel, enabled })
        .returning();
      if (!created) throw AppError.validation('Failed to create preference');
      return created;
    });
  }

  async setChannel(userId: string, channel: string, enabled: boolean) {
    if (!isKnownChannel(channel)) throw AppError.validation(`Unknown channel "${channel}"`);
    let changed = 0;
    for (const event of NOTIFICATION_EVENT_TYPES) {
      if (!enabled && isMandatory(event.key, channel)) continue;
      await this.setPreference(userId, event.key, channel, enabled);
      changed += 1;
    }
    return { channel, enabled, changed };
  }

  async isEnabled(userId: string, eventType: string, channel: NotificationChannel = 'in_app'): Promise<boolean> {
    const [row] = await this.db
      .select({ enabled: notificationPreference.enabled })
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.userId, userId),
          eq(notificationPreference.eventType, eventType),
          eq(notificationPreference.channel, channel),
        ),
      )
      .limit(1);
    return row ? row.enabled : defaultEnabled(eventType, channel);
  }
}
