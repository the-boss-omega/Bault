import type { Pool, PoolClient } from 'pg';
import { loadEnv, type Env } from '@bault/config';
import { createEmailAdapter, type EmailAdapter } from '@bault/adapters';
import { log } from '../log';
import { reportJobFailure } from '../observability';
import { notificationMessage } from './notification-message';
import { defaultEmailEnabled, eventSubject } from './notification-events';
import { PASSWORD_RESET_REQUESTED, sendPasswordReset } from './password-reset-mail';

const SINGLE_RECIPIENT_KEYS = ['ownerId', 'userId', 'sellerId', 'buyerId', 'responderId', 'donorId'];

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

export const MAX_ATTEMPTS = 5;
const RUN_LIMIT = 1_000;

async function deliver(db: PoolClient, env: Env, row: OutboxRow) {
  const counts = { delivered: 0, mailed: 0, failed: 0 };
  const message = notificationMessage(row.event_type, row.payload);
  const content = JSON.stringify({ ...(row.payload ?? {}), message });

  for (const recipientId of recipientsOf(row.payload)) {
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

      const counts =
        claimed.event_type === PASSWORD_RESET_REQUESTED
          ? await sendPasswordReset(client, claimed.payload, emailAdapter()).then(() => ({ delivered: 0, mailed: 0, failed: 0 }))
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
