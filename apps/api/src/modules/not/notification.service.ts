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

/**
 * Notification read model + preferences (NOT-01/NOT-02).
 *
 * Notifications are WRITTEN by the worker's outbox dispatch job; the API only
 * reads them (own feed) and manages preferences.
 *
 * The preferences half changed shape with email. It used to be one boolean per
 * event type, and `getPreferences` returned only the rows a user had already
 * changed — so a preferences screen could show what you had turned off and had
 * no way to show what you could turn off. It now serves the whole matrix,
 * defaults filled in, which is the only form a settings screen can actually
 * render.
 */
@Injectable()
export class NotificationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The caller's own notifications, newest first. */
  /**
   * The feed. In-app rows only: an event that was also emailed has a second
   * row for the email, and returning both showed every such event twice and
   * doubled the bell's count.
   */
  listMine(userId: string) {
    return this.db
      .select()
      .from(notification)
      .where(and(eq(notification.userId, userId), eq(notification.channel, 'in_app')))
      .orderBy(sql`${notification.createdAt} desc`);
  }

  /**
   * The full preference matrix: every known event type, on every channel, with
   * the user's choice where they made one and the default where they did not.
   *
   * The raw rows are still returned alongside it, because they are the only
   * evidence of what the user actually decided as opposed to what they were
   * given — and a settings screen that cannot tell those apart cannot offer
   * "reset to defaults".
   */
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
          /** True when this is the default rather than something they chose. */
          isDefault: explicit === undefined,
          /** Bad news cannot be switched off in the app (see the catalogue). */
          mandatory: isMandatory(event.key, channel),
        };
      }),
    }));

    return { categories: EVENT_CATEGORIES, channels: NOTIFICATION_CHANNELS, events: matrix, rows };
  }

  /** Upsert one (user, event type, channel) preference. */
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

  /**
   * Turn a whole channel off in one action.
   *
   * The one thing somebody reaching this screen in irritation actually wants is
   * "stop emailing me", and making them tick twenty-eight boxes to say it is a
   * dark pattern. Mandatory in-app events are left alone — the master switch
   * cannot be used to route around them.
   */
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

  /** Default per the catalogue: only an explicit row overrides it. */
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
