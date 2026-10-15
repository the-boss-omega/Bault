import { describe, it, expect, vi } from 'vitest';

/**
 * The environment schema (packages/config/src/env.ts).
 *
 * Imported by path: the repository root does not depend on `@bault/config`.
 * `loadEnv` caches its first result, so every case loads a fresh module.
 */
async function load(source: Record<string, string | undefined>) {
  vi.resetModules();
  const { loadEnv } = await import('../../packages/config/src/env');
  return loadEnv(source as NodeJS.ProcessEnv);
}

/** Enough to boot in development. */
const DEV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://bault:bault@localhost:6432/bault',
  DIRECT_DATABASE_URL: 'postgres://bault:bault@localhost:5432/bault',
  PAYMENT_PROVIDER: 'sandbox',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_REGION: 'eu-central',
  STORAGE_BUCKET: 'bault-images',
  STORAGE_ACCESS_KEY: 'k',
  STORAGE_SECRET_KEY: 's',
};

/**
 * A real-looking two-factor key: 32 bytes, base64. Not the development key —
 * production refuses that one by value.
 */
const MFA_KEY = Buffer.alloc(32, 7).toString('base64');

/** A configuration production accepts. */
const PROD = {
  ...DEV,
  MFA_ENCRYPTION_KEY: MFA_KEY,
  NODE_ENV: 'production',
  STORAGE_PROVIDER: 's3',
  PAYMENT_PROVIDER: 'paypal',
  PAYPAL_CLIENT_ID: 'id',
  PAYPAL_CLIENT_SECRET: 'secret',
  PAYPAL_WEBHOOK_ID: 'wh',
  SHIPPING_PROVIDER: 'easypost',
  EASYPOST_API_KEY: 'EZTK123',
  EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'u',
  SMTP_PASSWORD: 'p',
  SMTP_FROM: 'Bault <noreply@example.com>',
  APP_BASE_URL: 'https://app.example.com',
  TRUST_PROXY: 'uniquelocal',
};

describe('environment schema', () => {
  it('reads EXPOSE_API_DOCS=false as false', async () => {
    expect((await load({ ...DEV, EXPOSE_API_DOCS: 'false' })).EXPOSE_API_DOCS).toBe(false);
    expect((await load({ ...DEV, EXPOSE_API_DOCS: 'true' })).EXPOSE_API_DOCS).toBe(true);
  });

  it('accepts a complete production configuration', async () => {
    const env = await load(PROD);
    expect(env.NODE_ENV).toBe('production');
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_STATEMENT_TIMEOUT_MS).toBe(30_000);
  });

  it('no longer requires the unused session secret', async () => {
    expect((await load(DEV)).SESSION_COOKIE_SECRET).toBe('');
  });

  it('refuses the loopback proxy setting in production', async () => {
    await expect(load({ ...PROD, TRUST_PROXY: 'loopback' })).rejects.toThrow(/TRUST_PROXY/);
    await expect(load({ ...PROD, TRUST_PROXY: undefined })).rejects.toThrow(/TRUST_PROXY/);
  });

  it('refuses a non-https app origin in production', async () => {
    await expect(load({ ...PROD, APP_BASE_URL: 'http://app.example.com' })).rejects.toThrow(/APP_BASE_URL/);
  });

  it('refuses an open API explorer in production', async () => {
    await expect(load({ ...PROD, EXPOSE_API_DOCS: 'true' })).rejects.toThrow(/API_DOCS_PASSWORD/);
  });

  it('pays cash-outs through the provider unless told to record manual payouts', async () => {
    // Manual mode is how Bault launches before PayPal approves it for Payouts:
    // an administrator pays by hand and records the reference.
    expect((await load(DEV)).PAYOUT_MODE).toBe('provider');
    expect((await load({ ...DEV, PAYOUT_MODE: 'manual' })).PAYOUT_MODE).toBe('manual');
    expect((await load({ ...PROD, PAYOUT_MODE: 'manual' })).PAYOUT_MODE).toBe('manual');
    await expect(load({ ...DEV, PAYOUT_MODE: 'cheque' })).rejects.toThrow(/PAYOUT_MODE/);
  });

  it('reports the production refusals even when a required variable is also missing', async () => {
    const attempt = load({ ...PROD, DATABASE_URL: undefined, STORAGE_PROVIDER: 'sandbox' });
    await expect(attempt).rejects.toThrow(/DATABASE_URL/);
    await expect(load({ ...PROD, DATABASE_URL: undefined, STORAGE_PROVIDER: 'sandbox' })).rejects.toThrow(
      /STORAGE_PROVIDER=sandbox/,
    );
  });
});

/**
 * Two-factor sign-in.
 *
 * The TOTP secrets are encrypted at rest under MFA_ENCRYPTION_KEY, and staff
 * accounts must use a second factor in production. Both are configuration, so
 * both are refused at boot when they are wrong — a missing key would otherwise
 * surface as the first enrolment failing, and a production deployment that
 * quietly stopped requiring two-factor sign-in for administrators would surface
 * as nothing at all.
 */
describe('two-factor configuration', () => {
  it('requires MFA_ENCRYPTION_KEY in production', async () => {
    await expect(load({ ...PROD, MFA_ENCRYPTION_KEY: undefined })).rejects.toThrow(/MFA_ENCRYPTION_KEY/);
    await expect(load({ ...PROD, MFA_ENCRYPTION_KEY: '' })).rejects.toThrow(/MFA_ENCRYPTION_KEY/);
  });

  it('refuses a key that is not exactly 32 bytes of base64, in any environment', async () => {
    const short = Buffer.alloc(16, 7).toString('base64');
    await expect(load({ ...PROD, MFA_ENCRYPTION_KEY: short })).rejects.toThrow(/MFA_ENCRYPTION_KEY/);
    await expect(load({ ...DEV, MFA_ENCRYPTION_KEY: short })).rejects.toThrow(/MFA_ENCRYPTION_KEY/);
    await expect(load({ ...DEV, MFA_ENCRYPTION_KEY: 'not base64 at all, just a passphrase!!' })).rejects.toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
  });

  it('uses a development key outside production, and refuses that key in production', async () => {
    const dev = await load(DEV);
    expect(Buffer.from(dev.MFA_ENCRYPTION_KEY, 'base64')).toHaveLength(32);
    expect((await load({ ...DEV, MFA_ENCRYPTION_KEY: MFA_KEY })).MFA_ENCRYPTION_KEY).toBe(MFA_KEY);
    // The development key is in the source, so a production that used it
    // would be encrypting every secret under a published key.
    await expect(load({ ...PROD, MFA_ENCRYPTION_KEY: dev.MFA_ENCRYPTION_KEY })).rejects.toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
  });

  it('requires a second factor of admins and operators in production, and of nobody by default elsewhere', async () => {
    expect([...(await load(PROD)).MFA_REQUIRED_ROLES].sort()).toEqual(['admin', 'warehouse_operator']);
    expect([...(await load(DEV)).MFA_REQUIRED_ROLES]).toEqual([]);
    expect([...(await load({ ...DEV, NODE_ENV: 'test' })).MFA_REQUIRED_ROLES]).toEqual([]);
    const opted = await load({ ...DEV, MFA_REQUIRED_ROLES: 'admin, warehouse_operator' });
    expect([...opted.MFA_REQUIRED_ROLES].sort()).toEqual(['admin', 'warehouse_operator']);
  });

  it('refuses switching it off for staff in production', async () => {
    await expect(load({ ...PROD, MFA_REQUIRED_ROLES: '' })).rejects.toThrow(/MFA_REQUIRED_ROLES/);
    await expect(load({ ...PROD, MFA_REQUIRED_ROLES: 'admin' })).rejects.toThrow(/MFA_REQUIRED_ROLES/);
    await expect(load({ ...PROD, MFA_REQUIRED_ROLES: 'warehouse_operator' })).rejects.toThrow(/MFA_REQUIRED_ROLES/);
    // Stricter is allowed: collectors too.
    const all = await load({ ...PROD, MFA_REQUIRED_ROLES: 'admin,warehouse_operator,user' });
    expect([...all.MFA_REQUIRED_ROLES].sort()).toEqual(['admin', 'user', 'warehouse_operator']);
  });

  it('refuses a role name it does not know, rather than enforcing nothing for it', async () => {
    // `operator` is not a role. Accepting it would leave every real operator
    // without the requirement while the configuration said otherwise.
    await expect(load({ ...DEV, MFA_REQUIRED_ROLES: 'admin,operator' })).rejects.toThrow(/MFA_REQUIRED_ROLES/);
  });
});
