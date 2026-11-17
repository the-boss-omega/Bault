import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { dispatchOutbox } from '../../apps/worker/src/jobs/outbox-dispatch';
import {
  EMAIL_CODE_TTL_MINUTES,
  MFA_EMAIL_CODE_REQUESTED,
  emailCodeHash as workerHash,
  emailCodeKey as workerKey,
  sendMfaEmailCode,
} from '../../apps/worker/src/jobs/mfa-email-code-mail';
import { emailCodeKey, emailCodeMatches } from '../../apps/api/src/modules/acc/mfa/email-codes';
import { keyFromBase64 } from '../../apps/api/src/modules/acc/mfa/secret-box';
import { count, createUser, testPool } from './helpers/db';

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const emailOf = async (userId: string) =>
  (await pool.query<{ email: string }>(`SELECT email FROM user_account WHERE id = $1`, [userId])).rows[0]!.email;

async function emailFactor(userId: string, opts: { enabled?: boolean; address?: string } = {}): Promise<void> {
  const enabled = opts.enabled ?? true;
  await pool.query(
    `INSERT INTO mfa_factor (user_id, method, email_address, enabled_at)
     VALUES ($1, 'email', $2, CASE WHEN $3::boolean THEN now() END)`,
    [userId, enabled ? (opts.address ?? (await emailOf(userId))) : null, enabled],
  );
}

async function requestCode(userId: string, purpose: 'sign_in' | 'settings' = 'sign_in'): Promise<{ codeId: string; outboxId: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO mfa_email_code (user_id, purpose) VALUES ($1, $2) RETURNING id`,
    [userId, purpose],
  );
  const codeId = rows[0]!.id;
  const { rows: out } = await pool.query<{ id: string }>(
    `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload)
     VALUES ('mfa_email_code', $1, $2, $3::jsonb) RETURNING id`,
    [codeId, MFA_EMAIL_CODE_REQUESTED, JSON.stringify({ codeId })],
  );
  return { codeId, outboxId: out[0]!.id };
}

/** The console mailer's lines for one address: the code mails the dispatch sent there. */
function watchMail() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return (to: string) =>
    log.mock.calls
      .filter((call) => String(call[0]).includes(`to=${to} `) && String(call[0]).includes('template=mfa_email_code'))
      .map((call) => call[1] as Record<string, string>);
}

const row = async (codeId: string) =>
  (
    await pool.query<{ code_hash: string | null; sent_to: string | null; minutes: number | null }>(
      `SELECT code_hash, sent_to, round(extract(epoch FROM expires_at - sent_at) / 60)::int AS minutes
         FROM mfa_email_code WHERE id = $1`,
      [codeId],
    )
  ).rows[0]!;

const undispatched = (id: string) => count(pool, `SELECT 1 FROM outbox_message WHERE id = $1 AND dispatched_at IS NULL`, [id]);

describe('mailing a two-factor code', () => {
  it('mints the code only when the message is dispatched, keeps its keyed hash, and mails it to the account', async () => {
    const mailsTo = watchMail();
    const user = await createUser(pool);
    const email = await emailOf(user);
    await emailFactor(user);
    const { codeId, outboxId } = await requestCode(user);
    expect((await row(codeId)).code_hash).toBeNull();

    await dispatchOutbox(pool);

    expect(await undispatched(outboxId)).toBe(0);
    const mails = mailsTo(email);
    expect(mails).toHaveLength(1);
    const code = mails[0]!.code!;
    expect(code).toMatch(/^\d{6}$/);
    expect(mails[0]!.purpose).toBe('sign_in');

    const stored = await row(codeId);
    expect(stored.sent_to).toBe(email);
    expect(stored.minutes).toBe(EMAIL_CODE_TTL_MINUTES);
    expect(stored.code_hash).not.toContain(code);
    // The API checks what the worker wrote: the two derive the same key and the same hash.
    const apiKey = emailCodeKey(keyFromBase64(loadEnv().MFA_ENCRYPTION_KEY));
    expect(workerKey().equals(apiKey)).toBe(true);
    expect(stored.code_hash).toBe(workerHash(apiKey, codeId, code));
    expect(emailCodeMatches(apiKey, codeId, code, stored.code_hash!)).toBe(true);
    expect(emailCodeMatches(apiKey, codeId, String((Number(code) + 1) % 1e6).padStart(6, '0'), stored.code_hash!)).toBe(false);
  });

  it('mails a settings code to an account that is still proving its address', async () => {
    const mailsTo = watchMail();
    const user = await createUser(pool);
    await emailFactor(user, { enabled: false });
    const { codeId } = await requestCode(user, 'settings');
    await dispatchOutbox(pool);
    expect(mailsTo(await emailOf(user))).toHaveLength(1);
    expect((await row(codeId)).code_hash).not.toBeNull();
  });

  it('mails nothing for a code replaced before it was sent, or asked for too long ago', async () => {
    const mailsTo = watchMail();
    const user = await createUser(pool);
    await emailFactor(user);
    const replaced = await requestCode(user);
    await pool.query(`UPDATE mfa_email_code SET consumed_at = now() WHERE id = $1`, [replaced.codeId]);
    const stale = await requestCode(user);
    await pool.query(`UPDATE mfa_email_code SET requested_at = now() - interval '11 minutes' WHERE id = $1`, [stale.codeId]);

    await dispatchOutbox(pool);
    expect(mailsTo(await emailOf(user))).toEqual([]);
    expect(await undispatched(replaced.outboxId)).toBe(0);
    expect(await undispatched(stale.outboxId)).toBe(0);
    expect((await row(stale.codeId)).code_hash).toBeNull();
  });

  it('mails nothing to a closed account, or once the factor is gone', async () => {
    const mailsTo = watchMail();
    const closed = await createUser(pool, 'closed');
    await emailFactor(closed);
    await requestCode(closed);
    const removed = await createUser(pool);
    await requestCode(removed);

    await dispatchOutbox(pool);
    expect(mailsTo(await emailOf(closed))).toEqual([]);
    expect(mailsTo(await emailOf(removed))).toEqual([]);
  });

  it('mails a sign-in code only to the address the factor proved', async () => {
    const mailsTo = watchMail();
    const user = await createUser(pool);
    await emailFactor(user, { address: 'somebody-else@fixture.bault.test' });
    const { codeId } = await requestCode(user);
    await dispatchOutbox(pool);
    expect(mailsTo(await emailOf(user))).toEqual([]);
    expect(mailsTo('somebody-else@fixture.bault.test')).toEqual([]);
    expect((await row(codeId)).code_hash).toBeNull();
  });

  it('keeps no code and leaves the message to be retried when the mail fails', async () => {
    const user = await createUser(pool);
    await emailFactor(user);
    const { codeId } = await requestCode(user);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        sendMfaEmailCode(client, { codeId }, { send: async () => Promise.reject(new Error('smtp down')) }),
      ).rejects.toThrow(/smtp down/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect((await row(codeId)).code_hash).toBeNull();

    const sent: string[] = [];
    const c2 = await pool.connect();
    try {
      await c2.query('BEGIN');
      await sendMfaEmailCode(c2, { codeId }, {
        send: async (m) => {
          sent.push(m.variables.code!);
          return { providerRef: 'ok' };
        },
      });
      await c2.query('COMMIT');
    } finally {
      c2.release();
    }
    expect(sent).toHaveLength(1);
    expect((await row(codeId)).code_hash).not.toBeNull();
  });

  it('mails one code when two dispatchers run at the same time', async () => {
    const mailsTo = watchMail();
    const user = await createUser(pool);
    await emailFactor(user);
    await requestCode(user);
    await Promise.all([dispatchOutbox(pool), dispatchOutbox(pool)]);
    expect(mailsTo(await emailOf(user))).toHaveLength(1);
  });

  it('ignores a message that names no code', async () => {
    const client = await pool.connect();
    try {
      const send = vi.fn();
      await sendMfaEmailCode(client, { codeId: 'not-a-uuid' }, { send });
      await sendMfaEmailCode(client, null, { send });
      expect(send).not.toHaveBeenCalled();
    } finally {
      client.release();
    }
  });
});
