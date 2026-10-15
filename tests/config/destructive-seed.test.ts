import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The seed refuses production, and so does the reset at the end of `pnpm test`.
 *
 * `apps/api/src/db/seed.ts` TRUNCATEs every table — the ledger, the custody
 * trail and the audit log included, because row triggers do not fire on
 * TRUNCATE — and creates two admin accounts whose password is in the source.
 * Its only guard against production was a comment saying not to. It also
 * shipped in the API image as dist/db/seed.js, and `pnpm test` ran it after
 * every run against whatever database `.env` named.
 *
 * Every case points the seed at 127.0.0.1:1, where nothing listens. A seed
 * that gets past the guard fails with ECONNREFUSED instead of touching any
 * database, which is exactly how these tests tell "refused" from "proceeded".
 */

const ROOT = join(__dirname, '..', '..');
const API_DIR = join(ROOT, 'apps', 'api');
const SEED = join(API_DIR, 'src', 'db', 'seed.ts');
const TSX = pathToFileURL(createRequire(join(API_DIR, 'package.json')).resolve('tsx')).href;

const NOWHERE = 'postgres://nobody:nobody@127.0.0.1:1/nowhere';

/** A configuration production accepts, so the env schema is not what stops it. */
const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: NOWHERE,
  DIRECT_DATABASE_URL: NOWHERE,
  STORAGE_PROVIDER: 's3',
  STORAGE_ENDPOINT: 'https://storage.example.com',
  STORAGE_REGION: 'eu-central',
  STORAGE_BUCKET: 'bault-images',
  STORAGE_ACCESS_KEY: 'k',
  STORAGE_SECRET_KEY: 's',
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

/**
 * Run the seed from `cwd` with exactly `env` — nothing inherited, so a
 * developer's exported DATABASE_URL can never leak in. `loadEnv` still reads
 * the nearest `.env` above `cwd`, which is why the cases below run from a
 * scratch directory rather than from the repository.
 */
function seed(cwd: string, env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', TSX, SEED], {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

describe('the destructive seed', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'bault-seed-guard-'));
  });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it('refuses NODE_ENV=production before it opens a connection', () => {
    const r = seed(scratch, PROD);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('Refusing to seed: NODE_ENV=production');
    expect(r.output).toContain('ALLOW_DESTRUCTIVE_SEED=yes-i-am-sure');
    expect(r.output, 'it got as far as the database').not.toContain('ECONNREFUSED');
  }, 60_000);

  it('refuses NODE_ENV=production read from a .env file, even one that fails validation', () => {
    // The development .env with only NODE_ENV flipped: sandbox providers, so
    // `loadEnv` throws on it. The refusal must still be what is reported.
    const dir = mkdtempSync(join(scratch, 'dotenv-'));
    writeFileSync(join(dir, '.env'), `NODE_ENV=production\nDATABASE_URL=${NOWHERE}\nDIRECT_DATABASE_URL=${NOWHERE}\n`);
    const r = seed(dir, {});
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('Refusing to seed: NODE_ENV=production');
    expect(r.output).not.toContain('ECONNREFUSED');
  }, 60_000);

  it('runs in production only with the explicit confirmation, and outside production without one', () => {
    for (const env of [
      { ...PROD, ALLOW_DESTRUCTIVE_SEED: 'yes-i-am-sure' },
      { ...PROD, NODE_ENV: 'development', PAYMENT_PROVIDER: 'sandbox' },
    ]) {
      const r = seed(scratch, env);
      expect(r.output).not.toContain('Refusing to seed');
      // Past the guard, it went for the database — which is not there.
      expect(r.output).toContain('ECONNREFUSED');
    }
  }, 120_000);

  it('accepts no other spelling of the confirmation', () => {
    const r = seed(scratch, { ...PROD, ALLOW_DESTRUCTIVE_SEED: 'yes' });
    expect(r.output).toContain('Refusing to seed: NODE_ENV=production');
    expect(r.output).not.toContain('ECONNREFUSED');
  }, 60_000);
});

/**
 * `pnpm test` ends by re-seeding. Under production it must refuse that reset,
 * and so refuse the run before the first suite writes anything.
 *
 * `npx` and `pnpm` are replaced on PATH by stubs that only record how they were
 * called, so the script's control flow is exercised without running a single
 * suite or touching a database.
 */
describe('scripts/test.mjs', () => {
  let bin: string;
  let calls: string;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), 'bault-test-mjs-'));
    calls = join(bin, 'calls.log');
    for (const tool of ['npx', 'pnpm']) {
      const stub = join(bin, tool);
      writeFileSync(stub, `#!/bin/sh\necho "${tool} $*" >> "${calls}"\nexit 0\n`);
      chmodSync(stub, 0o755);
    }
  });
  afterAll(() => rmSync(bin, { recursive: true, force: true }));

  function runTestScript(env: Record<string, string>) {
    rmSync(calls, { force: true });
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'test.mjs')], {
      cwd: ROOT,
      env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, ...env },
      encoding: 'utf8',
      timeout: 30_000,
    });
    const log = existsSync(calls) ? readFileSync(calls, 'utf8') : '';
    return { status: r.status, output: `${r.stdout}\n${r.stderr}`, log };
  }

  it('refuses NODE_ENV=production before it runs a suite or seeds anything', () => {
    const r = runTestScript({ NODE_ENV: 'production' });
    expect(r.log, 'the seed ran').not.toContain('db:seed');
    expect(r.log, 'a suite ran').not.toContain('vitest');
    expect(r.output).toContain('Refusing to run: NODE_ENV=production');
    expect(r.status).not.toBe(0);
  });

  it('passes the confirmation through, and resets as before outside production', () => {
    expect(runTestScript({ NODE_ENV: 'production', ALLOW_DESTRUCTIVE_SEED: 'yes-i-am-sure' }).log).toContain(
      'pnpm --filter @bault/api db:seed',
    );
    const dev = runTestScript({ NODE_ENV: 'development' });
    expect(dev.log).toContain('pnpm --filter @bault/api db:seed');
    expect(dev.status).toBe(0);
  });
});
