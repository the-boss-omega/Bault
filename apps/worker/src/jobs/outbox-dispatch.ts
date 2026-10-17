import type { Pool, PoolClient } from 'pg';
import { loadEnv, type Env } from '@bault/config';
import { createEmailAdapter, type EmailAdapter } from '@bault/adapters';
import { log } from '../log';
import { reportJobFailure } from '../observability';
import { notificationMessage } from './notification-message';
import { defaultEmailEnabled, eventSubject } from './notification-events';
import { PASSWORD_RESET_REQUESTED, sendPasswordReset } from './password-reset-mail';

/**
 * Outbox dispatch.
 *
 * Turns undelivered outbox_message rows into notifications. Recipients come from
 * the event payload: an explicit `recipientIds` array when an event concerns
 * several people (a swap notifies both sides), otherwise the first of the
 * single-recipient keys in SINGLE_RECIPIENT_KEYS. The outbox row is marked
 * dispatched REGARDLESS, so a message with no resolvable recipient (or an
 * opted-out one) is consumed, not retried forever.
 *
 * Two channels. In-app cannot fail: writing the row is the delivery. Email is
 * best-effort and cannot break the notification it accompanies:
 *
 *   - the in-app row is written FIRST, and a failed send is caught, so a dead
 *     mail server cannot cost somebody their notification;
 *   - a failed send is recorded as a `failed` row rather than swallowed, so a
 *     bounce stays visible;
 *   - only an ACTIVE account is mailed. A `pending` account has not proved it
 *     owns its address.
 *
 * The stored content carries a rendered `message` next to the original payload
 * fields, and BOTH channels send that same sentence.
 *
 * ONE MESSAGE AT A TIME, EACH IN ITS OWN TRANSACTION. Each message is CLAIMED
 * with `FOR UPDATE SKIP LOCKED`, so a second dispatcher skips it rather than
 * notifying everybody twice, and its notifications and its `dispatched_at`
 * commit together or not at all. A message that throws is rolled back alone,
 * keeps its error and an attempt count, and the run moves on. After
 * `MAX_ATTEMPTS` it is left undispatched, with its error, for a person to look at.
 *
 * Email is sent inside the claim. If the process dies between the send and the
 * commit, the mail goes twice; committing first would lose it instead. At least
 * once is the right side to fail on for a notification.
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
 * The mail adapter, built once per process and chosen the same way the API
 * chooses it (`@bault/adapters`). In development `console` puts the body in the log.
 */
let mailer: EmailAdapter | undefined;
function emailAdapter(): EmailAdapter {
  return (mailer ??= createEmailAdapter(loadEnv()));
}

interface Recipient {
  id: string;
  email: string;
  status: string;
  firstName: string | null;
}

interface OutboxRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
}

/** Whether a channel is on for this user and event, defaults filled in. */
async function channelEnabled(
  db: PoolClient,
  userId: string,
  eventType: string,
  channel: 'in_app' | 'email',
): Promise<boolean> {
  const { rows } = await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preference
      WHERE user_id = $1 AND event_type = $2 AND channel = $3
      LIMIT 1`,
    [userId, eventType, channel],
  );
  if (rows.length > 0) return rows[0]!.enabled;
  return channel === 'in_app' ? true : defaultEmailEnabled(eventType);
}

/** A message that has failed this many times is left for a person. */
export const MAX_ATTEMPTS = 5;
/** The most messages one run will take on; the next minute's run does the rest. */
const RUN_LIMIT = 1_000;

/** Turn one claimed message into its notifications, on the claiming transaction. */
async function deliver(db: PoolClient, env: Env, row: OutboxRow) {
  const counts = { delivered: 0, mailed: 0, failed: 0 };
  const message = notificationMessage(row.event_type, row.payload);
  const content = JSON.stringify({ ...(row.payload ?? {}), message });

  for (const recipientId of recipientsOf(row.payload)) {
    // In-app first. Nothing about email can cost somebody the notification it
    // was meant to accompany.
    if (await channelEnabled(db, recipientId, row.event_type, 'in_app')) {
      await db.query(
        `INSERT INTO notification (user_id, event_type, content, channel, status)
         VALUES ($1, $2, $3, 'in_app', 'sent')`,
        [recipientId, row.event_type, content],
      );
      counts.delivered += 1;
    }

    if (!(await channelEnabled(db, recipientId, row.event_type, 'email'))) continue;

    const { rows: people } = await db.query<Recipient>(
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
      await db.query(
        `INSERT INTO notification (user_id, event_type, content, channel, status, provider_ref)
         VALUES ($1, $2, $3, 'email', 'sent', $4)`,
        [recipientId, row.event_type, content, result.providerRef],
      );
      counts.mailed += 1;
    } catch (err) {
      // Recorded, not swallowed, so a bounce leaves a trace.
      await db.query(
        `INSERT INTO notification (user_id, event_type, content, channel, status, failure_reason)
         VALUES ($1, $2, $3, 'email', 'failed', $4)`,
        [recipientId, row.event_type, content, (err as Error).message.slice(0, 500)],
      );
      counts.failed += 1;
    }
  }
  return counts;
}

export async function dispatchOutbox(pool: Pool): Promise<void> {
  const env = loadEnv();
  const tried: string[] = [];
  let dispatched = 0;
  let delivered = 0;
  let mailed = 0;
  let failed = 0;
  let errored = 0;

  while (tried.length < RUN_LIMIT) {
    const client = await pool.connect();
    let claimed: OutboxRow | undefined;
    try {
      await client.query('BEGIN');
      // Oldest first, skipping anything another dispatcher holds and anything
      // this run already tried, so a message that failed waits for the next run.
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, event_type, payload
           FROM outbox_message
          WHERE dispatched_at IS NULL
            AND attempts < $1
            AND NOT (id = ANY($2::uuid[]))
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [MAX_ATTEMPTS, tried],
      );
      claimed = rows[0];
      if (!claimed) {
        await client.query('COMMIT');
        break;
      }
      tried.push(claimed.id);

      // A reset link is account mail, not a notification: no in-app row, no
      // preferences, and it goes to an address that may not have confirmed
      // itself. The token is minted and mailed on its own connection; this
      // transaction only marks the message dispatched.
      const counts =
        claimed.event_type === PASSWORD_RESET_REQUESTED
          ? await sendPasswordReset(pool, claimed.payload, emailAdapter()).then(() => ({ delivered: 0, mailed: 0, failed: 0 }))
          : await deliver(client, env, claimed);
      await client.query(
        `UPDATE outbox_message
            SET dispatched_at = now(), attempts = attempts + 1, last_attempt_at = now()
          WHERE id = $1`,
        [claimed.id],
      );
      await client.query('COMMIT');
      dispatched += 1;
      delivered += counts.delivered;
      mailed += counts.mailed;
      failed += counts.failed;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Failing to CLAIM is the database, not a message: let the job fail and
      // pg-boss retry it.
      if (!claimed) throw err;
      errored += 1;
      await recordFailure(pool, claimed, err);
    } finally {
      client.release();
    }
  }

  log.info('outbox dispatched', {
    job: 'outbox.dispatch',
    dispatched,
    delivered_in_app: delivered,
    emailed: mailed,
    email_failed: failed,
    errored,
  });
}

/**
 * Keep what went wrong on the message itself, outside the transaction that was
 * rolled back, so it survives. Reported once it has used its last try.
 */
async function recordFailure(pool: Pool, row: OutboxRow, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 1_000);
  const { rows } = await pool.query<{ attempts: number }>(
    `UPDATE outbox_message
        SET attempts = attempts + 1, last_error = $2, last_attempt_at = now()
      WHERE id = $1
      RETURNING attempts`,
    [row.id, message],
  );
  const attempts = rows[0]?.attempts ?? 0;
  const fields = { job: 'outbox.dispatch', outboxId: row.id, eventType: row.event_type, attempts, error: message };
  if (attempts >= MAX_ATTEMPTS) {
    log.error('outbox message given up on — it needs a person', fields);
    reportJobFailure('outbox.dispatch', err);
  } else {
    log.warn('outbox message failed; it will be retried', fields);
  }
}
