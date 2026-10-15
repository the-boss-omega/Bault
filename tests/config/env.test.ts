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

/** A configuration production accepts. */
const PROD = {
  ...DEV,
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
