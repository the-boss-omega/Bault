import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { accrueInterest } from '../../apps/worker/src/jobs/interest-accrual';
import { count, createUser, ledger, testPool } from './helpers/db';

/**
 * Daily interest on a debt past its grace period (F051, N9).
 *
 * `.env` sets a 14-day grace and 5 bps a day, so a $100 debt that is twenty days
 * old accrues one interest row a day. One — not one per run.
 */
let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

const interestRows = (pool: Pool, userId: string) =>
  count(pool, `SELECT 1 FROM ledger_record WHERE user_id = $1 AND type = 'interest'`, [userId]);

describe('interest accrual run more than once in a day', () => {
  it('charges one day of interest when the job runs twice (F051)', async () => {
    const debtor = await createUser(pool);
    await ledger(pool, debtor, 'debit', 10_000, 20);

    await accrueInterest(pool);
    expect(await interestRows(pool, debtor)).toBe(1);

    // pg-boss retries a failed job immediately, and every INSERT before the
    // failure had already committed — so a retry charged everybody again.
    await accrueInterest(pool);
    expect(await interestRows(pool, debtor)).toBe(1);
  });

  it('charges one day of interest when two runs overlap (F051)', async () => {
    const debtor = await createUser(pool);
    await ledger(pool, debtor, 'debit', 10_000, 20);
    await Promise.all([accrueInterest(pool), accrueInterest(pool)]);
    expect(await interestRows(pool, debtor)).toBe(1);
  });
});

describe('interest on an account that is closed (N9)', () => {
  it('accrues nothing on a closed account', async () => {
    const closed = await createUser(pool, 'closed');
    await ledger(pool, closed, 'debit', 10_000, 20);
    await accrueInterest(pool);
    expect(await interestRows(pool, closed)).toBe(0);
  });
});
