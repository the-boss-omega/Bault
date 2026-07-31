import type { Pool } from 'pg';
import { notificationMessage } from './notification-message';

/**
 * Outbox dispatch (T128, Principle XI).
 *
 * Turns undelivered outbox_message rows into in-app notifications. Recipients come
 * from the event payload: an explicit `recipientIds` array when an event concerns
 * several people (a swap notifies both sides), otherwise the first of the
 * single-recipient conventions used by emitters (ownerId / userId / sellerId /
 * buyerId / responderId / donorId). A notification is only written when the user
 * has NOT opted out of that event type (no notification_preference row with
 * enabled = false). The outbox row is marked dispatched REGARDLESS, so a message
 * with no resolvable recipient (or an opted-out one) is consumed, not retried forever.
 *
 * The stored content always carries a rendered, human-readable `message`
 * (Requirement 6.1) next to the original payload fields.
 */
const SINGLE_RECIPIENT_KEYS = ['ownerId', 'userId', 'sellerId', 'buyerId', 'responderId', 'donorId'];

/** Resolve every user who should receive this event, de-duplicated. */
function recipientsOf(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const many = payload.recipientIds;
  if (Array.isArray(many)) {
    return [...new Set(many.filter((id): id is string => typeof id === 'string' && id !== ''))];
  }
  for (const key of SINGLE_RECIPIENT_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' && value !== '') return [value];
  }
  return [];
}

export async function dispatchOutbox(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    event_type: string;
    payload: Record<string, unknown> | null;
  }>(
    `SELECT id, event_type, payload
     FROM outbox_message
     WHERE dispatched_at IS NULL
     ORDER BY created_at`,
  );

  let delivered = 0;
  for (const row of rows) {
    const message = notificationMessage(row.event_type, row.payload);
    const content = JSON.stringify({ ...(row.payload ?? {}), message });

    for (const recipient of recipientsOf(row.payload)) {
      const optedOut = await pool.query(
        `SELECT 1 FROM notification_preference
         WHERE user_id = $1 AND event_type = $2 AND enabled = false
         LIMIT 1`,
        [recipient, row.event_type],
      );
      if ((optedOut.rowCount ?? 0) === 0) {
        await pool.query(
          `INSERT INTO notification (user_id, event_type, content, channel, status)
           VALUES ($1, $2, $3, 'in_app', 'sent')`,
          [recipient, row.event_type, content],
        );
        delivered += 1;
      }
    }
    // Consumed either way — never re-dispatch the same message.
    await pool.query(`UPDATE outbox_message SET dispatched_at = now() WHERE id = $1`, [row.id]);
  }
  // eslint-disable-next-line no-console
  console.log(`[job:outbox] dispatched ${rows.length} message(s), delivered ${delivered} notification(s)`);
}
