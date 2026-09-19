import { afterAll, describe, expect, it } from 'vitest';
import pg from '../../apps/worker/node_modules/pg';
import { runStorageFees } from '../../apps/worker/src/jobs/storage-fee';
import { SEED, fundWallet, intakeFor, signIn } from './helpers/http';

/**
 * A membership stops the storage clock — it doesn't just defer the bill.
 *
 * The sweep bills "periods started since the included window, minus periods
 * already settled". Covered periods used to leave no trace, so the day a
 * membership ended, every period that had passed while covered was billed at
 * once. They are now recorded in `storage_period_cover` (migration 0031) and
 * count as settled.
 *
 * Drives the real worker job against the database, scoped to one item so the
 * rest of the shared database is not billed. Requires a running API + seeded DB.
 */
const pool = new pg.Pool({
  connectionString:
    process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://bault:bault@localhost:5432/bault',
});
afterAll(() => pool.end());

async function counts(itemId: string) {
  const charged = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM charge WHERE reference_id = $1 AND action_type IN ('storage','storage_oversized')`,
    [itemId],
  );
  const covered = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM storage_period_cover WHERE item_id = $1`,
    [itemId],
  );
  return { charged: charged.rows[0]!.n, covered: covered.rows[0]!.n };
}

const receivedDaysAgo = (itemId: string, days: number) =>
  pool.query(`UPDATE item SET received_at = now() - make_interval(days => $2) WHERE id = $1`, [itemId, days]);

describe('storage under a membership', () => {
  it('never bills the periods a membership covered, even after it ends', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector3, { typeClass: 'trading_card' });

    // Stored 400 days: 180 included, then periods starting at days 180, 270, 360.
    await receivedDaysAgo(item.id, 400);

    await fundWallet(SEED.collector3, 10_000);
    const member = await signIn(SEED.collector3);
    const joined = await member.post('/membership/subscribe', { tier: 'folio' });
    expect([200, 201]).toContain(joined.status);

    await runStorageFees(pool, { itemIds: [item.id] });
    expect(await counts(item.id)).toEqual({ charged: 0, covered: 3 });

    // Cover ends. Before 0031, the next sweep billed all three covered periods.
    await pool.query(
      `UPDATE membership SET status = 'ended'
        WHERE user_id = (SELECT id::text FROM user_account WHERE email = $1)`,
      [SEED.collector3],
    );
    await runStorageFees(pool, { itemIds: [item.id] });
    expect(await counts(item.id)).toEqual({ charged: 0, covered: 3 });

    // Only a period that starts after cover ended is billed — exactly one.
    await receivedDaysAgo(item.id, 490);
    await runStorageFees(pool, { itemIds: [item.id] });
    expect(await counts(item.id)).toEqual({ charged: 1, covered: 3 });

    // And a second run the same day bills nothing more.
    await runStorageFees(pool, { itemIds: [item.id] });
    expect(await counts(item.id)).toEqual({ charged: 1, covered: 3 });
  });

  it('keeps the cover record append-only', async () => {
    await expect(pool.query(`DELETE FROM storage_period_cover WHERE period_no = 1`)).rejects.toThrow(
      /append_only_violation/,
    );
  });
});
