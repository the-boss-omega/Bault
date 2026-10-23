import { createHash, randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { base32Decode, timeStep, totp } from '../../../apps/api/src/modules/acc/mfa/totp';
import { CURRENT_TERMS_VERSION } from '../../../apps/api/src/modules/acc/terms';
import { BASE, Client, fixtureEmail } from './http';
import { sql } from './db';

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
