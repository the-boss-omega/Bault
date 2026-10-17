import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { runStorageFees } from '../../apps/worker/src/jobs/storage-fee';
import { count, createItem, createMembership, createUser, storageCharges, testPool, warm } from './helpers/db';

/**
 * The nightly storage sweep.
 *
 * The seeded rule is the standard one: 180 days included, then one period every
 * 90 days. An item received 400 days ago is therefore three periods in —
 * day 180, day 270 and day 360 have all started.
 */
let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

describe('a membership that stops covering an item', () => {
  it('bills at most one period when cover ends, not every period the item was covered for (F009, F021)', async () => {
    const member = await createUser(pool);
    await createMembership(pool, member, { endsInMinutes: 60 * 24 * 10 });
    const card = await createItem(pool, member, 400);

    // While the cycle is live the card is inside the allowance and costs nothing.
    await runStorageFees(pool);
    expect(await storageCharges(pool, card)).toBe(0);

    // The member cancels and the cycle ends.
    await pool.query(`UPDATE membership SET status = 'ended', ended_at = now() WHERE user_id = $1`, [member]);

    // Counting periods from `received_at` would find three started and none
    // billed, and charge all three the night cover ended: rent for the months
    // the subscription had promised were free.
    await runStorageFees(pool);
    expect(await storageCharges(pool, card)).toBe(1);

    // And a second run the same night changes nothing.
    await runStorageFees(pool);
    expect(await storageCharges(pool, card)).toBe(1);
  });

  it('does not bill a member whose cycle ran out minutes before the sweep and is about to renew (F021)', async () => {
    const member = await createUser(pool);
    // Active and auto-renewing, but the cycle closed at 01:55 and the hourly
    // renewal last ran at 01:40.
    await createMembership(pool, member, { endsInMinutes: -5 });
    const card = await createItem(pool, member, 400);

    await runStorageFees(pool);

    expect(await storageCharges(pool, card)).toBe(0);
    const { rows } = await pool.query<{ live: boolean }>(
      `SELECT current_period_end > now() AS live FROM membership WHERE user_id = $1`,
      [member],
    );
    expect(rows[0]!.live).toBe(true);
  });
});

describe('running the sweep more than once', () => {
  it('bills the same periods run once, run twice, or run twice at the same moment (F070)', async () => {
    const owner = await createUser(pool);
    const once = await createItem(pool, owner, 400);
    await runStorageFees(pool);
    expect(await storageCharges(pool, once)).toBe(3);
    await runStorageFees(pool);
    expect(await storageCharges(pool, once)).toBe(3);

    // Two sweeps overlapping: a retry after the job's lease expired while the
    // first was still running, or a second worker replica. Neither may bill a
    // period because it counted the charges before the other had committed.
    // Enough items that each sweep's inserts take a while, so the two really
    // do overlap.
    const items: string[] = [];
    for (let i = 0; i < 20; i += 1) items.push(await createItem(pool, owner, 400));
    await warm(pool);
    await Promise.all([runStorageFees(pool), runStorageFees(pool)]);
    expect(
      await count(
        pool,
        `SELECT 1 FROM charge WHERE action_type = 'storage' AND reference_id = ANY($1::text[])`,
        [items],
      ),
    ).toBe(20 * 3);
  });
});
