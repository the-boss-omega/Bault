import type { Pool } from 'pg';

/**
 * Interest accrual (T069, Principle: negative balance accrues interest).
 *
 * For every user whose derived balance (Σ ledger) is negative, append an
 * `interest` DEBIT proportional to the debt. This INCREASES the debt until the
 * user settles — expressed purely as new append-only ledger rows (never edits).
 * Rate is a configurable daily basis-point figure (0.05%/day here).
 */
const DAILY_INTEREST_BPS = 5;

export async function accrueInterest(pool: Pool): Promise<void> {
  const result = await pool.query(
    `
    INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type)
    SELECT b.user_id,
           'interest',
           GREATEST(1, (b.debt * $1 / 10000))::bigint,
           'debit',
           'USD',
           'interest'
    FROM (
      SELECT user_id,
             -SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS debt
      FROM ledger_record
      GROUP BY user_id
      HAVING SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) < 0
    ) b
    `,
    [DAILY_INTEREST_BPS],
  );
  // eslint-disable-next-line no-console
  console.log(`[job:interest] accrued interest for ${result.rowCount ?? 0} negative-balance account(s)`);
}
