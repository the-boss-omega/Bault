import type { Pool, PoolClient } from 'pg';
import { loadEnv, type Env } from '@bault/config';
import { createEmailAdapter, type EmailAdapter } from '@bault/adapters';
import { log } from '../log';
import { reportJobFailure } from '../observability';
import { notificationMessage } from './notification-message';
import { defaultEmailEnabled, eventSubject } from './notification-events';
import { PASSWORD_RESET_REQUESTED, sendPasswordReset } from './password-reset-mail';
import { MFA_EMAIL_CODE_REQUESTED, sendMfaEmailCode } from './mfa-email-code-mail';
import { OCR_REQUESTED } from './ocr-read';

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

let configuredMailer: EmailAdapter | undefined;
function emailAdapter(): EmailAdapter {
  return (configuredMailer ??= createEmailAdapter(loadEnv()));
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
const CLAIM_IDLE_LIMIT = '5min';
const RUN_LIMIT = 1_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidAt = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && UUID.test(value) ? value : null;
};

async function withCodes(
  db: PoolClient,
  payload: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  if (!payload) return payload;
  const out = { ...payload };
  const transactionId = uuidAt(payload, 'transactionId');
  if (transactionId && typeof payload.transactionCode !== 'string') {
    const { rows } = await db.query<{ code: string | null }>(`SELECT code FROM transaction WHERE id = $1`, [
      transactionId,
    ]);
    if (rows[0]?.code) out.transactionCode = rows[0].code;
  }
  const listingId = uuidAt(payload, 'listingId');
  if (listingId && typeof payload.barcode !== 'string') {
    const { rows } = await db.query<{ barcode: string }>(
      `SELECT i.barcode FROM listing l JOIN item i ON i.id = l.item_id WHERE l.id = $1`,
      [listingId],
    );
    if (rows[0]?.barcode) out.barcode = rows[0].barcode;
  }
  return out;
}

async function deliver(db: PoolClient, env: Env, row: OutboxRow, mailer: EmailAdapter) {
  const counts = { delivered: 0, mailed: 0, failed: 0 };
  const payload = await withCodes(db, row.payload);
  const message = notificationMessage(row.event_type, payload);
  const content = JSON.stringify({ ...(payload ?? {}), message });

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
      const result = await mailer.send({
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

export async function dispatchOutbox(pool: Pool, mailer: EmailAdapter = emailAdapter()): Promise<void> {
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
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${CLAIM_IDLE_LIMIT}'`);
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, event_type, payload
           FROM outbox_message
          WHERE dispatched_at IS NULL
            AND attempts < $1
            AND NOT (id = ANY($2::uuid[]))
            AND event_type <> $3
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [MAX_ATTEMPTS, tried, OCR_REQUESTED],
      );
      claimed = rows[0];
      if (!claimed) {
        await client.query('COMMIT');
        break;
      }
      tried.push(claimed.id);

      const counts =
        claimed.event_type === PASSWORD_RESET_REQUESTED
          ? await sendPasswordReset(client, claimed.payload, mailer).then(() => ({ delivered: 0, mailed: 0, failed: 0 }))
          : claimed.event_type === MFA_EMAIL_CODE_REQUESTED
            ? await sendMfaEmailCode(client, claimed.payload, mailer).then((sent) => ({
                delivered: 0,
                mailed: sent ? 1 : 0,
                failed: 0,
              }))
            : await deliver(client, env, claimed, mailer);
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
