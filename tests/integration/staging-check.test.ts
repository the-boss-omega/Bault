import { createHash, randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { assertStagingTarget, runStagingCheck } from '../../scripts/staging-check/run.mjs';
import { BASE, SEED, SEED_PASSWORD } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

const TOKEN_TYPE = { verify: 'email_verification', reset: 'password_reset' } as const;

async function emailedToken(kind: keyof typeof TOKEN_TYPE, email: string): Promise<string> {
  const [row] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [email]);
  if (!row) throw new Error(`no account for ${email}`);
  const raw = randomBytes(32).toString('hex');
  await sql(
    `INSERT INTO verification_token (user_id, type, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [row.id, TOKEN_TYPE[kind], createHash('sha256').update(raw).digest('hex')],
  );
  return `https://staging.example.test/#/${kind === 'verify' ? 'verify-email' : 'reset-password'}?token=${raw}`;
}

describe('the staging check', () => {
  it('walks every journey against the sandbox providers and finds nothing wrong', async () => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
    const results = await runStagingCheck({
      apiBase: BASE,
      providers: 'sandbox',
      admin: { identifier: SEED.admin, password: SEED_PASSWORD },
      totp: async () => {
        throw new Error('the seeded admin has no second factor');
      },
      inbox: (label: string) => `chk-${label}-${stamp}@staging-check.bault.test`,
      link: emailedToken,
      skip: ['worker'],
    });

    const failed = results.filter((r: { status: string }) => r.status === 'fail');
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);

    const passed = new Set(results.filter((r: { status: string }) => r.status === 'pass').map((r: { id: string }) => r.id));
    for (const id of [
      'api',
      'admin',
      'prices',
      'bins',
      'signup',
      'reset',
      'cash-in',
      'intake',
      'listing',
      'purchase',
      'label-domestic',
      'label-international',
      'escrow',
      'cash-out',
      'payout-retry',
      'webhook-forged',
    ]) {
      expect(passed, `${id} did not pass`).toContain(id);
    }

    const byId = new Map(results.map((r: { id: string; status: string }) => [r.id, r.status]));
    expect(byId.get('worker')).toBe('skip');
    expect(byId.get('unrateable')).toBe('skip');
    expect(byId.get('payout-reversal')).toBe('skip');
  }, 180_000);

  it('runs only against a target named as staging, and never against the production host', () => {
    expect(() => assertStagingTarget('https://staging.bault.example', { productionHost: 'bault.example' })).toThrow(
      /--target staging/,
    );
    expect(() =>
      assertStagingTarget('https://staging.bault.example', { target: 'production', productionHost: 'bault.example' }),
    ).toThrow(/--target staging/);
    expect(() =>
      assertStagingTarget('https://bault.example/api/v1', { target: 'staging', productionHost: 'bault.example' }),
    ).toThrow(/production/);
    expect(() =>
      assertStagingTarget('https://www.bault.example', { target: 'staging', productionHost: 'https://bault.example/' }),
    ).toThrow(/production/);
    expect(() => assertStagingTarget('https://staging.bault.example', { target: 'staging' })).toThrow(
      /BAULT_PRODUCTION_HOST/,
    );
    expect(
      assertStagingTarget('https://staging.bault.example', { target: 'staging', productionHost: 'bault.example' }),
    ).toBe('https://staging.bault.example/api/v1');
    expect(
      assertStagingTarget('https://staging.bault.example/api/v1/', { target: 'staging', productionHost: 'bault.example' }),
    ).toBe('https://staging.bault.example/api/v1');
  });

  it('refuses a PayPal receiver that is not a sandbox account', () => {
    expect(() =>
      assertStagingTarget('https://staging.bault.example', {
        target: 'staging',
        productionHost: 'bault.example',
        paypalReceiver: 'me@gmail.com',
      }),
    ).toThrow(/sandbox/);
    expect(
      assertStagingTarget('https://staging.bault.example', {
        target: 'staging',
        productionHost: 'bault.example',
        paypalReceiver: 'sb-47abc@personal.example.com',
      }),
    ).toBe('https://staging.bault.example/api/v1');
  });
});
