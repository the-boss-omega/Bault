import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { renewMemberships } from '../../apps/worker/src/jobs/membership-renewal';
import { count, createMembership, createUser, testPool, warm } from './helpers/db';

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
