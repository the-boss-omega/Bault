import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { notification, notificationPreference } from './notification.schema';

/**
 * Notification read model + preferences (NOT-01/NOT-02).
 *
 * Notifications are WRITTEN by the worker's outbox dispatch job; the API only
 * reads them (own feed) and manages per-event-type opt-outs. `isEnabled` defaults
 * to TRUE — a user receives every event type unless a preference row explicitly
 * disables it.
 */
@Injectable()
export class NotificationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The caller's own notifications, newest first. */
  listMine(userId: string) {
    return this.db
      .select()
      .from(notification)
      .where(eq(notification.userId, userId))
      .orderBy(sql`${notification.createdAt} desc`);
  }

  getPreferences(userId: string) {
    return this.db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, userId))
      .orderBy(notificationPreference.eventType);
  }

  /** Upsert the (userId, eventType) preference — update if it exists, else insert. */
  async setPreference(userId: string, eventType: string, enabled: boolean) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(notificationPreference)
        .where(and(eq(notificationPreference.userId, userId), eq(notificationPreference.eventType, eventType)))
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
        .values({ userId, eventType, enabled })
        .returning();
      if (!created) throw AppError.validation('Failed to create preference');
      return created;
    });
  }

  /** Default TRUE: only an explicit `enabled = false` row suppresses the event type. */
  async isEnabled(userId: string, eventType: string): Promise<boolean> {
    const [row] = await this.db
      .select({ enabled: notificationPreference.enabled })
      .from(notificationPreference)
      .where(and(eq(notificationPreference.userId, userId), eq(notificationPreference.eventType, eventType)))
      .limit(1);
    return row ? row.enabled : true;
  }
}
