import type { Pool, PoolClient } from 'pg';
import { loadEnv, type Env } from '@bault/config';
import { createEmailAdapter, type EmailAdapter } from '@bault/adapters';
import { log } from '../log';
import { reportJobFailure } from '../observability';
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
 *
 * ONE MESSAGE AT A TIME, EACH IN ITS OWN TRANSACTION (step 10, N29).
 *
 * This used to read every undispatched row up front and work through the list
 * with autocommitted writes. Two things went wrong with that:
 *
 *   - Two dispatchers — a second replica, or a run still going when the next
 *     minute's started — read the same list and notified everybody twice.
 *   - One message that threw escaped the loop. Nothing behind it was
 *     dispatched, and the next minute's run hit the same row first: the outbox
 *     stopped for everybody, while the in-app rows already written for the bad
 *     message were written again on every retry.
 *
 * Now each message is CLAIMED with `FOR UPDATE SKIP LOCKED` — a second
 * dispatcher skips it rather than waiting for it — and its notifications and its
 * `dispatched_at` commit together or not at all. A message that throws is rolled
 * back alone, keeps its error and an attempt count, and the run moves on. After
 * `MAX_ATTEMPTS` it is left undispatched, with its error, for a person to look
 * at, rather than retried every minute forever.
 *
 * Email is sent inside the claim. If the process dies between the send and the
 * commit, the message is dispatched again and the mail goes twice; the
 * alternative — committing first — would lose it. At least once is the right
 * side to fail on for a notification.
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
 * The mail adapter, built once per process — chosen the same way the API
 * chooses it (`@bault/adapters`).
 *
 * `console` is the development sink and is a perfectly good answer: it proves
 * the pipeline end to end and puts the body in the log, which is what a
 * developer without a mail server actually wants.
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
    // In-app first, and on its own. Nothing about email can cost somebody the
    // notification it was meant to accompany.
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
      // Recorded, not swallowed. A bounce that leaves no trace is worse than
      // no email at all, because nobody can tell it happened.
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
      // this run already tried — a message that failed waits for the next run
      // rather than being hammered in a loop.
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

      const counts = await deliver(client, env, claimed);
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
 * rolled back, so it survives — and say so loudly once it has used its last try.
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
