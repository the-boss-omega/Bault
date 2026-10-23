import { describe, it, expect, vi } from 'vitest';

async function load(source: Record<string, string | undefined>) {
  vi.resetModules();
  const { loadEnv } = await import('../../packages/config/src/env');
  return loadEnv(source as NodeJS.ProcessEnv);
}

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

const MFA_KEY = Buffer.alloc(32, 7).toString('base64');

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
  });

  it('still parses an env file that sets the retired statement timeout', async () => {
    const env = await load({ ...PROD, DATABASE_STATEMENT_TIMEOUT_MS: '30000' });
    expect(env).not.toHaveProperty('DATABASE_STATEMENT_TIMEOUT_MS');
  });

  it('no longer requires the unused session secret', async () => {
    expect((await load(DEV)).SESSION_COOKIE_SECRET).toBe('');
  });

  it('refuses the loopback proxy setting in production', async () => {
    await expect(load({ ...PROD, TRUST_PROXY: 'loopback' })).rejects.toThrow(/TRUST_PROXY/);
    await expect(load({ ...PROD, TRUST_PROXY: undefined })).rejects.toThrow(/TRUST_PROXY/);
  });

  it('refuses a non-https app origin in production', async () => {
    await expect(load({ ...PROD, APP_BASE_URL: 'http://app.example.com' })).rejects.toThrow(
      /APP_BASE_URL/,
    );
  });

  it('requires SMTP over TLS except for a local catcher in development', async () => {
    expect((await load(PROD)).SMTP_REQUIRE_TLS).toBe(true);
    await expect(load({ ...PROD, SMTP_REQUIRE_TLS: 'false' })).rejects.toThrow(/SMTP_REQUIRE_TLS/);
    await expect(
      load({
        ...DEV,
        NODE_ENV: 'test',
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'h',
        SMTP_USER: 'u',
        SMTP_PASSWORD: 'p',
        SMTP_FROM: 'f',
        SMTP_REQUIRE_TLS: 'false',
      }),
    ).rejects.toThrow(/SMTP_REQUIRE_TLS/);
    const catcher = {
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_USER: 'u',
      SMTP_PASSWORD: 'p',
      SMTP_FROM: 'f',
    };
    expect((await load({ ...DEV, ...catcher, SMTP_REQUIRE_TLS: 'false' })).SMTP_REQUIRE_TLS).toBe(
      false,
    );
  });

  it('refuses an open API explorer in production', async () => {
    await expect(load({ ...PROD, EXPOSE_API_DOCS: 'true' })).rejects.toThrow(/API_DOCS_PASSWORD/);
  });

  it('pays cash-outs through the provider unless told to record manual payouts', async () => {
    expect((await load(DEV)).PAYOUT_MODE).toBe('provider');
    expect((await load({ ...DEV, PAYOUT_MODE: 'manual' })).PAYOUT_MODE).toBe('manual');
    expect((await load({ ...PROD, PAYOUT_MODE: 'manual' })).PAYOUT_MODE).toBe('manual');
    await expect(load({ ...DEV, PAYOUT_MODE: 'cheque' })).rejects.toThrow(/PAYOUT_MODE/);
  });

  it('reports the production refusals even when a required variable is also missing', async () => {
    const attempt = load({ ...PROD, DATABASE_URL: undefined, STORAGE_PROVIDER: 'sandbox' });
    await expect(attempt).rejects.toThrow(/DATABASE_URL/);
    await expect(
      load({ ...PROD, DATABASE_URL: undefined, STORAGE_PROVIDER: 'sandbox' }),
    ).rejects.toThrow(/STORAGE_PROVIDER=sandbox/);
  });
});

describe('two-factor configuration', () => {
  it('requires MFA_ENCRYPTION_KEY in production', async () => {
    await expect(load({ ...PROD, MFA_ENCRYPTION_KEY: undefined })).rejects.toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
    await expect(load({ ...PROD, MFA_ENCRYPTION_KEY: '' })).rejects.toThrow(/MFA_ENCRYPTION_KEY/);
  });

  it('refuses a key that is not exactly 32 bytes of base64, in any environment', async () => {
    const short = Buffer.alloc(16, 7).toString('base64');
    await expect(load({ ...PROD, MFA_ENCRYPTION_KEY: short })).rejects.toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
    await expect(load({ ...DEV, MFA_ENCRYPTION_KEY: short })).rejects.toThrow(/MFA_ENCRYPTION_KEY/);
    await expect(
      load({ ...DEV, MFA_ENCRYPTION_KEY: 'not base64 at all, just a passphrase!!' }),
    ).rejects.toThrow(/MFA_ENCRYPTION_KEY/);
  });

  it('uses a development key outside production, and refuses that key in production', async () => {
    const dev = await load(DEV);
    expect(Buffer.from(dev.MFA_ENCRYPTION_KEY, 'base64')).toHaveLength(32);
    expect((await load({ ...DEV, MFA_ENCRYPTION_KEY: MFA_KEY })).MFA_ENCRYPTION_KEY).toBe(MFA_KEY);
    await expect(load({ ...PROD, MFA_ENCRYPTION_KEY: dev.MFA_ENCRYPTION_KEY })).rejects.toThrow(
      /MFA_ENCRYPTION_KEY/,
    );
  });

  it('requires a second factor of admins and operators in production, and of nobody by default elsewhere', async () => {
    expect([...(await load(PROD)).MFA_REQUIRED_ROLES].sort()).toEqual([
      'admin',
      'warehouse_operator',
    ]);
    expect([...(await load(DEV)).MFA_REQUIRED_ROLES]).toEqual([]);
    expect([...(await load({ ...DEV, NODE_ENV: 'test' })).MFA_REQUIRED_ROLES]).toEqual([]);
    const opted = await load({ ...DEV, MFA_REQUIRED_ROLES: 'admin, warehouse_operator' });
    expect([...opted.MFA_REQUIRED_ROLES].sort()).toEqual(['admin', 'warehouse_operator']);
  });

  it('refuses switching it off for staff in production', async () => {
    await expect(load({ ...PROD, MFA_REQUIRED_ROLES: '' })).rejects.toThrow(/MFA_REQUIRED_ROLES/);
    await expect(load({ ...PROD, MFA_REQUIRED_ROLES: 'admin' })).rejects.toThrow(
      /MFA_REQUIRED_ROLES/,
    );
    await expect(load({ ...PROD, MFA_REQUIRED_ROLES: 'warehouse_operator' })).rejects.toThrow(
      /MFA_REQUIRED_ROLES/,
    );
    const all = await load({ ...PROD, MFA_REQUIRED_ROLES: 'admin,warehouse_operator,user' });
    expect([...all.MFA_REQUIRED_ROLES].sort()).toEqual(['admin', 'user', 'warehouse_operator']);
  });

  it('refuses a role name it does not know, rather than enforcing nothing for it', async () => {
    await expect(load({ ...DEV, MFA_REQUIRED_ROLES: 'admin,operator' })).rejects.toThrow(
      /MFA_REQUIRED_ROLES/,
    );
  });
});
