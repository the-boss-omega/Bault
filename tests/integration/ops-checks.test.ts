import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { adminNeedsCode } from '../../scripts/ops/security-check.mjs';
import { BASE, SEED, SEED_PASSWORD } from './helpers/http';
import { sql } from './helpers/db';
import { activeAccount, enrol, MFA_PASSWORD, passwordOnly } from './helpers/mfa';

const SITE = new URL(BASE).origin;

describe('pnpm ops:security-check, the administrator sign-in', () => {
  it('passes only when an administrator password alone opens no session', async () => {
    const account = await activeAccount('opssec');
    await enrol(await passwordOnly(account));
    await sql(`UPDATE user_account SET role = 'admin' WHERE id = $1`, [account.id]);
    try {
      const enrolled = await adminNeedsCode(BASE, { identifier: account.username, password: MFA_PASSWORD });
      expect(enrolled).toMatchObject({ ok: true });
    } finally {
      await sql(`UPDATE user_account SET role = 'user' WHERE id = $1`, [account.id]);
    }

    const noSecondFactor = await adminNeedsCode(BASE, { identifier: SEED.admin, password: SEED_PASSWORD });
    expect(noSecondFactor.ok).toBe(false);
    expect(noSecondFactor.detail).toMatch(/password alone opened/);

    const collector = await adminNeedsCode(BASE, { identifier: SEED.collector, password: SEED_PASSWORD });
    expect(collector.ok).toBe(false);
    expect(collector.detail).toMatch(/not an administrator/);
  });
});

describe('pnpm ops:load-test', () => {
  it('drives the read mix and the sign-ins, and reports percentiles', () => {
    const r = spawnSync(
      process.execPath,
      [
        join(__dirname, '..', '..', 'scripts', 'ops', 'load-test.mjs'),
        '--url', SITE,
        '--target', 'staging',
        '--rps', '8',
        '--duration', '4',
        '--sign-ins-per-minute', '20',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, BAULT_LOADTEST_IDENTIFIER: SEED.collector, BAULT_LOADTEST_PASSWORD: SEED_PASSWORD },
        timeout: 60_000,
      },
    );
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    for (const name of ['browse listings', 'vault items', 'wallet', 'sign in', 'sign out']) expect(r.stdout).toContain(name);
    expect(r.stdout).toMatch(/^all\s+\d+\s+0\s+\d+\s+\d+\s+\d+$/m);
    expect(r.stdout).toMatch(/PASSED: p95 \d+ ms/);
    expect(r.stdout).not.toContain(SEED_PASSWORD);
  });
});
