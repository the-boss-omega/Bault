import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { renewMemberships } from '../../apps/worker/src/jobs/membership-renewal';
import { SEED, signIn } from '../integration/helpers/http';
import { count, createMembership, createUser, ledger, testPool, warm } from './helpers/db';

/**
 * Membership renewal.
 *
 * A cycle that has run out is renewed once: one new period row, one charge for
 * the fee. Never two, however many times or however many workers run the job.
 */
let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

const periods = (pool: Pool, membershipId: string) =>
  count(pool, `SELECT 1 FROM membership_period WHERE membership_id = $1`, [membershipId]);
const fees = (pool: Pool, membershipId: string) =>
  count(pool, `SELECT 1 FROM charge WHERE action_type LIKE 'membership:%' AND reference_id = $1`, [
    membershipId,
  ]);
const statusOf = async (pool: Pool, membershipId: string) =>
  (
    await pool.query<{ status: string; live: boolean }>(
      `SELECT status, current_period_end > now() AS live FROM membership WHERE id = $1`,
      [membershipId],
    )
  ).rows[0]!;

describe('renewing a cycle that has run out', () => {
  it('renews once when run twice in a row', async () => {
    const m = await createMembership(pool, await createUser(pool), { endsInMinutes: -1 });
    await renewMemberships(pool);
    await renewMemberships(pool);
    expect(await periods(pool, m)).toBe(1);
    expect(await fees(pool, m)).toBe(1);
  });

  it('renews once when two runs overlap (N15)', async () => {
    const ms: string[] = [];
    for (let i = 0; i < 10; i += 1) ms.push(await createMembership(pool, await createUser(pool), { endsInMinutes: -1 }));
    await warm(pool);
    // If each run stamped its own `now()` as the new period start, the ON
    // CONFLICT on (membership_id, period_start) would never match and both runs
    // would open a period and charge the fee.
    await Promise.all([renewMemberships(pool), renewMemberships(pool)]);
    for (const m of ms) {
      expect(await periods(pool, m)).toBe(1);
      expect(await fees(pool, m)).toBe(1);
    }
  });
});

describe('an account that is no longer active (N9)', () => {
  it('does not renew or charge a closed account, and ends its membership', async () => {
    const m = await createMembership(pool, await createUser(pool, 'closed'), { endsInMinutes: -1 });
    await renewMemberships(pool);
    expect(await fees(pool, m)).toBe(0);
    expect(await periods(pool, m)).toBe(0);
    expect((await statusOf(pool, m)).status).toBe('ended');
  });

  it('does not renew or charge a suspended account, and leaves the cycle lapsed for when it is reinstated', async () => {
    const user = await createUser(pool, 'suspended');
    const m = await createMembership(pool, user, { endsInMinutes: -1 });
    await renewMemberships(pool);
    expect(await fees(pool, m)).toBe(0);
    expect(await statusOf(pool, m)).toEqual({ status: 'active', live: false });

    // Reinstated: the next run renews it like any other.
    await pool.query(`UPDATE user_account SET status = 'active' WHERE id = $1`, [user]);
    await renewMemberships(pool);
    expect(await fees(pool, m)).toBe(1);
    expect(await statusOf(pool, m)).toEqual({ status: 'active', live: true });
  });
});

/**
 * A member upgrading at the moment the renewal job reaches their membership.
 *
 * Both touch the membership row and the wallet, and the lock order everywhere
 * is the row the operation is about, then the wallet (`LedgerService.lockWallet`).
 * Renewal takes them in that order. If subscribe took the wallet first, the two
 * could each hold one and wait for the other.
 *
 * Made deterministic by holding `ledger_record` for a moment: subscribe stops
 * at its balance read, after whatever it locks first and before the next lock.
 * Renewal is started then, and allowed to block before the table is released,
 * for longer than `deadlock_timeout`, so that if the cycle forms it is
 * subscribe's own deadlock check, the later one, that finds it.
 *
 * Needs the API, and signs in as a seeded collector.
 */
describe('a member subscribing while their membership is being renewed', () => {
  const waitFor = async (what: string, check: () => Promise<boolean>, timeoutMs = 10_000) => {
    const until = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('never deadlocks: both take the membership row before the wallet', async () => {
    const member = await signIn(SEED.collector3);
    const { rows } = await pool.query<{ id: string }>(`SELECT id::text AS id FROM user_account WHERE email = $1`, [
      SEED.collector3,
    ]);
    const userId = rows[0]!.id;
    await ledger(pool, userId, 'credit', 100_000);

    // Nothing else due, so the run below reaches this membership and only it.
    await renewMemberships(pool);
    const existing = await pool.query<{ id: string }>(`SELECT id FROM membership WHERE user_id = $1`, [userId]);
    if (existing.rows[0]) {
      await pool.query(
        `UPDATE membership
            SET tier = 'folio', status = 'active', scheduled_tier = NULL, cancelled_at = NULL, ended_at = NULL,
                current_period_start = now() - interval '30 days 1 minute', current_period_end = now() - interval '1 minute'
          WHERE user_id = $1`,
        [userId],
      );
    } else {
      await createMembership(pool, userId, { tier: 'folio', endsInMinutes: -1 });
    }
    const membershipId = (await pool.query<{ id: string }>(`SELECT id FROM membership WHERE user_id = $1`, [userId]))
      .rows[0]!.id;
    const feesBefore = await fees(pool, membershipId);

    const timeout = await pool.query<{ ms: string }>(
      `SELECT (EXTRACT(EPOCH FROM current_setting('deadlock_timeout')::interval) * 1000)::text AS ms`,
    );
    const deadlockTimeoutMs = Number(timeout.rows[0]!.ms);

    const holder = await pool.connect();
    let subscribing: Promise<{ status: number; body: unknown }> | undefined;
    let renewing: Promise<void> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE ledger_record IN ACCESS EXCLUSIVE MODE');

      subscribing = member.post('/membership/subscribe', { tier: 'registry' });
      await waitFor('subscribe to reach its balance read', async () => {
        const r = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks WHERE relation = 'ledger_record'::regclass AND NOT granted`,
        );
        return r.rows[0]!.n > 0;
      });

      let renewed = false;
      renewing = renewMemberships(pool).then(() => {
        renewed = true;
      });
      await waitFor('the renewal to finish or to wait for a wallet', async () => {
        if (renewed) return true;
        const r = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`,
        );
        return r.rows[0]!.n > 0;
      });
      await new Promise((r) => setTimeout(r, deadlockTimeoutMs + 500));
    } finally {
      await holder.query('COMMIT').catch(() => undefined);
      holder.release();
    }

    const res = await subscribing!;
    await renewing;

    // The upgrade went through, and the renewal left the membership to it
    // rather than renewing the old tier underneath it.
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const m = await pool.query<{ tier: string; live: boolean }>(
      `SELECT tier, current_period_end > now() AS live FROM membership WHERE id = $1`,
      [membershipId],
    );
    expect(m.rows[0]).toEqual({ tier: 'registry', live: true });
    expect(await fees(pool, membershipId)).toBe(feesBefore + 1);
  });
});
