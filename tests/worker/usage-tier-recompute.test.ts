import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { recomputeUsageTiers } from '../../apps/worker/src/jobs/usage-tier-recompute';
import { runScheduledJob } from '../../apps/worker/src/heartbeat';
import { JobName } from '../../apps/worker/src/jobs/registry';
import { createMembership, createUser, testPool } from './helpers/db';

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

async function charges(userId: string, n: number, amountMinor: number, daysAgo = 0): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, created_at)
       VALUES ($1, 'intake', '{}'::jsonb, $2, 'USD', 'wallet', 'settled', now() - make_interval(days => $3::int))
       RETURNING id`,
      [userId, amountMinor, daysAgo],
    );
    await pool.query(
      `INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type, reference_id)
       VALUES ($1, 'service_charge', $2, 'debit', 'USD', 'charge', $3)`,
      [userId, amountMinor, rows[0]!.id],
    );
  }
}

const tierOf = async (userId: string) =>
  (
    await pool.query<{ usage_tier: string; computed: boolean }>(
      `SELECT usage_tier, usage_tier_computed_at > now() - interval '1 minute' AS computed FROM user_account WHERE id = $1`,
      [userId],
    )
  ).rows[0]!;

const history = async (userId: string) =>
  (
    await pool.query<{ from_tier: string; to_tier: string; actions: number; spent_minor: string; reason: string }>(
      `SELECT from_tier, to_tier, actions, spent_minor::text, reason FROM usage_tier_change
        WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    )
  ).rows;

describe('the nightly usage tier recompute', () => {
  it('moves an account whose charges have aged out, and writes the history row with the counts behind it', async () => {
    const user = await createUser(pool);
    await charges(user, 12, 5_000);
    expect((await tierOf(user)).usage_tier).toBe('silver');
    expect(await history(user)).toEqual([
      { from_tier: 'bronze', to_tier: 'silver', actions: 10, spent_minor: '50000', reason: 'charge' },
    ]);

    await pool.query(
      `UPDATE charge SET created_at = now() - interval '95 days'
        WHERE id IN (SELECT id FROM charge WHERE user_id = $1 ORDER BY created_at LIMIT 5)`,
      [user],
    );
    await recomputeUsageTiers(pool);

    expect(await tierOf(user)).toEqual({ usage_tier: 'bronze', computed: true });
    expect((await history(user)).at(-1)).toEqual({
      from_tier: 'silver',
      to_tier: 'bronze',
      actions: 7,
      spent_minor: '35000',
      reason: 'nightly',
    });
  });

  it('raises an account whose stored tier fell behind its charges, and leaves no row for an account that stays where it is', async () => {
    const climber = await createUser(pool);
    const steady = await createUser(pool);
    await charges(steady, 2, 1_000);
    await charges(climber, 30, 100);
    await pool.query(`UPDATE user_account SET usage_tier = 'bronze' WHERE id = $1`, [climber]);
    expect((await tierOf(climber)).usage_tier).toBe('bronze');

    await recomputeUsageTiers(pool);

    expect((await tierOf(climber)).usage_tier).toBe('gold');
    expect((await history(climber)).at(-1)).toEqual({
      from_tier: 'bronze',
      to_tier: 'gold',
      actions: 30,
      spent_minor: '3000',
      reason: 'nightly',
    });
    expect(await tierOf(steady)).toEqual({ usage_tier: 'bronze', computed: true });
    expect(await history(steady)).toEqual([]);
  });

  it('runs under its own queue name, nightly', async () => {
    expect(JobName.USAGE_TIER_RECOMPUTE).toBe('usage-tier.recompute');
    await runScheduledJob(pool, JobName.USAGE_TIER_RECOMPUTE, () => recomputeUsageTiers(pool));
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM worker_heartbeat WHERE job_name = $1 AND last_error IS NULL`,
      [JobName.USAGE_TIER_RECOMPUTE],
    );
    expect(rows[0]!.n).toBe(1);
  });
});

describe('a paid membership after memberships stopped being sold', () => {
  const allowanceLive = async (membershipId: string) =>
    (
      await pool.query<{ status: string; honoured: boolean }>(
        `SELECT status, honoured_until > now() AS honoured FROM membership WHERE id = $1`,
        [membershipId],
      )
    ).rows[0]!;

  it('keeps its allowances until honoured_until, then the nightly job ends it without charging', async () => {
    const user = await createUser(pool);
    const m = await createMembership(pool, user, { tier: 'silver', endsInMinutes: 60 * 24 * 5 });

    await recomputeUsageTiers(pool);
    expect(await allowanceLive(m)).toEqual({ status: 'active', honoured: true });

    await pool.query(
      `UPDATE membership SET honoured_until = now() - interval '1 minute', current_period_end = now() - interval '1 minute'
        WHERE id = $1`,
      [m],
    );
    await recomputeUsageTiers(pool);

    expect(await allowanceLive(m)).toEqual({ status: 'ended', honoured: false });
    const fees = await pool.query(`SELECT 1 FROM charge WHERE user_id = $1`, [user]);
    expect(fees.rowCount).toBe(0);
    expect((await tierOf(user)).usage_tier).toBe('bronze');
  });
});
