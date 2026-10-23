import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { MEMBERSHIP_TIERS } from '../../apps/api/src/modules/mem/tiers';
import { BASE, SEED, SEED_PASSWORD, signIn } from './helpers/http';
import { sql } from './helpers/db';
import { activeAccount, codeAt, enrol, MFA_PASSWORD, passwordOnly } from './helpers/mfa';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'ops', 'prices.mjs');
const SITE = new URL(BASE).origin;
const ENDED = ['storage', 'membership:folio', 'grading_fee:psa_value', 'shipping_rush'];

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, '--url', SITE, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BAULT_ADMIN_IDENTIFIER: SEED.admin,
      BAULT_ADMIN_PASSWORD: SEED_PASSWORD,
      BAULT_ADMIN_TOTP: '',
      ...env,
    },
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

async function coverage() {
  const admin = await signIn(SEED.admin);
  return (await admin.get('/admin/pricing/coverage')).body as { ready: boolean; actions: { actionType: string; status: string }[] };
}

async function newestCatchAll(actionType: string) {
  const [row] = await sql<{ parameters: Record<string, number> | null; value: string }>(
    `SELECT parameters, value FROM pricing_rule
      WHERE action_type = $1 AND item_class IS NULL AND effective_from <= now()
        AND (effective_to IS NULL OR effective_to > now())
      ORDER BY effective_from DESC LIMIT 1`,
    [actionType],
  );
  return row;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('pnpm prices:load', () => {
  it('loads every price the server lacks, through the admin API, and turns coverage ready', async () => {
    await sql(
      `UPDATE pricing_rule SET effective_to = now()
        WHERE action_type = ANY($1) AND item_class IS NULL
          AND (effective_to IS NULL OR effective_to > now())`,
      [ENDED],
    );
    expect((await coverage()).ready).toBe(false);

    const dry = run(['--dry-run']);
    expect(dry.status, dry.out).toBe(0);
    for (const a of ENDED) expect(dry.out).toMatch(new RegExp(`load\\s+${escape(a)}\\s`));
    expect((await coverage()).ready).toBe(false);

    const refused = run([]);
    expect(refused.status, refused.out).toBe(1);
    expect(refused.out).toMatch(/"reviewed": false/);
    expect((await coverage()).ready).toBe(false);

    const loaded = run(['--allow-unreviewed']);
    expect(loaded.status, loaded.out).toBe(0);
    for (const a of ENDED) expect(loaded.out).toMatch(new RegExp(`loaded\\s+${escape(a)}\\s`));
    expect((await coverage()).ready).toBe(true);

    expect((await newestCatchAll('storage'))!.parameters).toEqual({
      freeDays: 180,
      periodDays: 90,
      percentOfIntakeBps: 1000,
    });
    const folio = MEMBERSHIP_TIERS.find((t) => t.key === 'folio')!;
    expect((await newestCatchAll('membership:folio'))!.parameters).toMatchObject({
      storedItems: folio.storedItems,
      commissionWaivedOnMinor: folio.commissionWaivedOnMinor,
    });

    const again = run(['--allow-unreviewed']);
    expect(again.status, again.out).toBe(0);
    expect(again.out).toMatch(/\b0 to load\b/);
    expect(again.out).toMatch(/Loaded 0\./);
  });

  it('with --update makes the server match the file, and --check says when it no longer does', async () => {
    const updated = run(['--update', '--allow-unreviewed']);
    expect(updated.status, updated.out).toBe(0);
    const matches = run(['--check']);
    expect(matches.status, matches.out).toBe(0);
    expect(matches.out).toMatch(/CHECK PASSED/);

    const admin = await signIn(SEED.admin);
    const changed = await admin.post('/pricing/rules', {
      actionType: 'shipping_rush',
      description: 'Same-day picking and packing, ahead of the standard queue',
      model: 'fixed',
      value: 1234,
      billingTrigger: 'per_event',
    });
    expect(changed.status).toBe(201);
    const drifted = run(['--check']);
    expect(drifted.status, drifted.out).toBe(1);
    expect(drifted.out).toMatch(/differs\s+shipping_rush\s+file \$10\.00, server \$12\.34\s+\(value\)/);

    const restored = run(['--update', '--allow-unreviewed']);
    expect(restored.status, restored.out).toBe(0);
    expect(Number((await newestCatchAll('shipping_rush'))!.value)).toBe(1000);
  });

  it('refuses an account that is not an administrator', () => {
    const r = run(['--dry-run'], { BAULT_ADMIN_IDENTIFIER: SEED.collector });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/not an administrator/);
  });

  it('asks an enrolled administrator for the code from their authenticator app', async () => {
    const account = await activeAccount('opsprc');
    const { secret } = await enrol(await passwordOnly(account));
    await sql(`UPDATE user_account SET role = 'admin' WHERE id = $1`, [account.id]);
    try {
      const creds = { BAULT_ADMIN_IDENTIFIER: account.username, BAULT_ADMIN_PASSWORD: MFA_PASSWORD };
      const noCode = run(['--dry-run'], creds);
      expect(noCode.status).toBe(1);
      expect(noCode.out).toMatch(/authenticator app/);

      const withCode = run(['--dry-run'], { ...creds, BAULT_ADMIN_TOTP: codeAt(secret, 1) });
      expect(withCode.status, withCode.out).toBe(0);
      expect(withCode.out).toMatch(/Dry run: nothing changed\./);
      expect(withCode.out).not.toContain(MFA_PASSWORD);
    } finally {
      await sql(`UPDATE user_account SET role = 'user' WHERE id = $1`, [account.id]);
    }
  });
});
