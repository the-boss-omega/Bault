import { createHash, randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { base32Decode, timeStep, totp } from '../../../apps/api/src/modules/acc/mfa/totp';
import { CURRENT_TERMS_VERSION } from '../../../apps/api/src/modules/acc/terms';
import { MFA_EMAIL_CODE_REQUESTED, sendMfaEmailCode } from '../../../apps/worker/src/jobs/mfa-email-code-mail';
import { BASE, Client, fixtureEmail } from './http';
import { inTransaction, sql } from './db';

export const MFA_PASSWORD = 'correct horse battery';

export interface Account {
  email: string;
  username: string;
  id: string;
}

export async function activeAccount(label: string, base = BASE): Promise<Account> {
  const email = fixtureEmail(label);
  const username = `${label.slice(0, 6)}${randomBytes(5).toString('hex')}`;
  const res = await new Client(base).post('/auth/register', {
    email,
    username,
    firstName: 'Two',
    lastName: 'Factor',
    password: MFA_PASSWORD,
    acceptedTermsVersion: CURRENT_TERMS_VERSION,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const [row] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [email]);
  const token = randomBytes(32).toString('hex');
  await sql(
    `INSERT INTO verification_token (user_id, type, token_hash, expires_at)
     VALUES ($1, 'email_verification', $2, now() + interval '1 day')`,
    [row!.id, createHash('sha256').update(token).digest('hex')],
  );
  expect((await new Client(base).post('/auth/verify-email', { token })).status).toBe(200);
  return { email, username, id: row!.id };
}

export async function passwordOnly(account: Account, base = BASE): Promise<Client> {
  const c = new Client(base);
  const res = await c.post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).not.toBe('mfa_required');
  return c;
}

export function codeAt(secret: Buffer, offset = 0): string {
  return totp(secret, Date.now() + offset * 30_000);
}

export function wrongCode(secret: Buffer): string {
  const near = new Set([-2, -1, 0, 1, 2].map((o) => codeAt(secret, o)));
  for (let n = 0; ; n += 1) {
    const candidate = String((123456 + n * 7919) % 1_000_000).padStart(6, '0');
    if (!near.has(candidate)) return candidate;
  }
}

export async function enrol(c: Client): Promise<{ secret: Buffer; recoveryCodes: string[] }> {
  const setup = await c.post('/auth/mfa/setup');
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const secret = base32Decode(setup.body.secret as string);
  const confirmed = await c.post('/auth/mfa/confirm', { code: codeAt(secret), password: MFA_PASSWORD });
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return { secret, recoveryCodes: confirmed.body.recoveryCodes as string[] };
}

export async function challenge(account: Account, base = BASE): Promise<string> {
  const res = await new Client(base).post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.status).toBe('mfa_required');
  return res.body.challengeToken as string;
}

export const nowStep = () => timeStep(Date.now());

export interface Mail {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, string>;
}

/**
 * Does for one account what the worker's outbox dispatch does with its waiting code mails: each is minted and
 * "sent" in its own transaction, by the worker's own job, and the outbox message is marked dispatched. Returns the
 * mail that would have gone out, oldest first. No worker runs beside the integration suite, so nothing else sends.
 */
export async function deliverCodes(account: { id: string }): Promise<Mail[]> {
  const waiting = await sql<{ id: string; payload: Record<string, unknown> }>(
    `SELECT o.id, o.payload FROM outbox_message o
      WHERE o.event_type = $1 AND o.dispatched_at IS NULL
        AND EXISTS (SELECT 1 FROM mfa_email_code c WHERE c.id::text = o.payload->>'codeId' AND c.user_id = $2)
      ORDER BY o.created_at`,
    [MFA_EMAIL_CODE_REQUESTED, account.id],
  );
  const sent: Mail[] = [];
  const mailer = {
    send: async (message: Mail) => {
      sent.push(message);
      return { providerRef: `test_${sent.length}` };
    },
  };
  for (const message of waiting) {
    await inTransaction(async (client) => {
      await sendMfaEmailCode(client as never, message.payload, mailer);
      await client.query(`UPDATE outbox_message SET dispatched_at = now(), attempts = attempts + 1 WHERE id = $1`, [
        message.id,
      ]);
    });
  }
  return sent;
}

/** The code in the newest mail the worker would send this account now. */
export async function mailedCode(account: { id: string }): Promise<string> {
  const mail = await deliverCodes(account);
  expect(mail.length, 'a code mail was waiting').toBeGreaterThan(0);
  const code = mail.at(-1)!.variables.code!;
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

/** A six-digit code that is not `code`. */
export function otherCode(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, '0');
}

/** Moves this account's code requests back in time, as if they were asked for `seconds` earlier. */
export async function ageCodeRequests(account: { id: string }, seconds: number): Promise<void> {
  await sql(
    `UPDATE mfa_email_code SET requested_at = requested_at - make_interval(secs => $2) WHERE user_id = $1`,
    [account.id, seconds],
  );
}

/** Sets up email codes as the second factor through the API, as the settings screen does. */
export async function enrolByEmail(c: Client, account: Account): Promise<{ recoveryCodes: string[] }> {
  const setup = await c.post('/auth/mfa/setup', { method: 'email' });
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const code = await mailedCode(account);
  const confirmed = await c.post('/auth/mfa/confirm', { method: 'email', code, password: MFA_PASSWORD });
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return { recoveryCodes: confirmed.body.recoveryCodes as string[] };
}

/** A right password for an account with email codes: the challenge, with the code mailed for it. */
export async function emailChallenge(
  account: Account,
  base = BASE,
): Promise<{ token: string; body: Record<string, unknown> }> {
  const res = await new Client(base).post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body).toMatchObject({ status: 'mfa_required', method: 'email' });
  return { token: res.body.challengeToken as string, body: res.body };
}
