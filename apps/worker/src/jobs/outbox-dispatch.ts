import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { ConsoleEmailAdapter, SmtpEmailAdapter, type EmailAdapter } from '@bault/adapters';
import { notificationMessage } from './notification-message';
import { defaultEmailEnabled, eventSubject } from './notification-events';

/**
 * Outbox dispatch (T128, Principle XI).
 *
 * Turns undelivered outbox_message rows into notifications. Recipients come from
 * the event payload: an explicit `recipientIds` array when an event concerns
 * several people (a swap notifies both sides), otherwise the first of the
 * single-recipient conventions used by emitters (ownerId / userId / sellerId /
 * buyerId / responderId / donorId). The outbox row is marked dispatched
 * REGARDLESS, so a message with no resolvable recipient (or an opted-out one) is
 * consumed, not retried forever.
 *
 * TWO CHANNELS now. In-app is unchanged and cannot fail — writing the row is the
 * delivery. Email is best-effort and is deliberately built so that nothing about
 * it can break the thing it accompanies:
 *
 *   - the in-app row is written FIRST and independently, so a dead mail server
 *     cannot cost somebody their notification;
 *   - a failed send is recorded as a `failed` row rather than swallowed, because
 *     a mail that bounced has to be visible as a mail that bounced;
 *   - only an ACTIVE account is mailed. A `pending` account has not confirmed
 *     its address — mailing it would be sending somebody else's vault activity
 *     to an address nobody has proved they own.
 *
 * The stored content always carries a rendered, human-readable `message`
 * (Requirement 6.1) next to the original payload fields, and BOTH channels send
 * that same sentence.
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

/**
 * The mail adapter, built once per process.
 *
 * `console` is the development sink and is a perfectly good answer: it proves
 * the pipeline end to end and puts the body in the log, which is what a
 * developer without a mail server actually wants.
 */
let mailer: EmailAdapter | undefined;
function emailAdapter(): EmailAdapter {
  if (mailer) return mailer;
  const env = loadEnv();
  mailer =
    env.EMAIL_PROVIDER === 'smtp'
      ? new SmtpEmailAdapter({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          user: env.SMTP_USER,
          password: env.SMTP_PASSWORD,
          from: env.SMTP_FROM,
        })
      : new ConsoleEmailAdapter();
  return mailer;
}

interface Recipient {
  id: string;
  email: string;
  status: string;
  firstName: string | null;
}

/** Whether a channel is on for this user and event, defaults filled in. */
async function channelEnabled(
  pool: Pool,
  userId: string,
  eventType: string,
  channel: 'in_app' | 'email',
): Promise<boolean> {
  const { rows } = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preference
      WHERE user_id = $1 AND event_type = $2 AND channel = $3
      LIMIT 1`,
    [userId, eventType, channel],
  );
  if (rows.length > 0) return rows[0]!.enabled;
  return channel === 'in_app' ? true : defaultEmailEnabled(eventType);
}

export async function dispatchOutbox(pool: Pool): Promise<void> {
  const env = loadEnv();
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
  let mailed = 0;
  let failed = 0;

  for (const row of rows) {
    const message = notificationMessage(row.event_type, row.payload);
    const content = JSON.stringify({ ...(row.payload ?? {}), message });

    for (const recipientId of recipientsOf(row.payload)) {
      // In-app first, and on its own. Nothing about email can cost somebody the
      // notification it was meant to accompany.
      if (await channelEnabled(pool, recipientId, row.event_type, 'in_app')) {
        await pool.query(
          `INSERT INTO notification (user_id, event_type, content, channel, status)
           VALUES ($1, $2, $3, 'in_app', 'sent')`,
          [recipientId, row.event_type, content],
        );
        delivered += 1;
      }

      if (!(await channelEnabled(pool, recipientId, row.event_type, 'email'))) continue;

      const { rows: people } = await pool.query<Recipient>(
        `SELECT id, email, status, first_name AS "firstName" FROM user_account WHERE id = $1 LIMIT 1`,
        [recipientId],
      );
      const person = people[0];
      // A `pending` account has never confirmed its address; a `closed` one has
      // asked to be left alone. Neither gets mail.
      if (!person || person.status !== 'active' || !person.email) continue;

      try {
        const result = await emailAdapter().send({
          to: person.email,
          subject: eventSubject(row.event_type),
          template: 'notification_event',
          variables: {
            heading: eventSubject(row.event_type),
            message,
            link: `${env.APP_BASE_URL}/#/notifications`,
          },
        });
        await pool.query(
          `INSERT INTO notification (user_id, event_type, content, channel, status, provider_ref)
           VALUES ($1, $2, $3, 'email', 'sent', $4)`,
          [recipientId, row.event_type, content, result.providerRef],
        );
        mailed += 1;
      } catch (err) {
        // Recorded, not swallowed. A bounce that leaves no trace is worse than
        // no email at all, because nobody can tell it happened.
        await pool.query(
          `INSERT INTO notification (user_id, event_type, content, channel, status, failure_reason)
           VALUES ($1, $2, $3, 'email', 'failed', $4)`,
          [recipientId, row.event_type, content, (err as Error).message.slice(0, 500)],
        );
        failed += 1;
      }
    }
    // Consumed either way — never re-dispatch the same message.
    await pool.query(`UPDATE outbox_message SET dispatched_at = now() WHERE id = $1`, [row.id]);
  }

  console.log(
    `[job:outbox] dispatched ${rows.length} message(s), delivered ${delivered} in-app, ${mailed} email, ${failed} failed`,
  );
}
