import type { Pool } from 'pg';

/**
 * Shared debt arithmetic for the two jobs that act on a negative wallet.
 *
 * Both interest accrual and the suspension sweep need the same two facts about
 * an indebted account — how much it owes, and how long it has owed it — so the
 * query that derives them lives here rather than being written twice and
 * drifting. A balance is never stored (Principle IV), so both are derived from
 * the append-only ledger every time.
 */

export interface DebtPosition {
  userId: string;
  /** Current balance in minor units. Always negative for a returned row. */
  balanceMinor: number;
  /** Debt in minor units — the positive magnitude of the balance. */
  debtMinor: number;
  /** When the balance most recently crossed from non-negative into negative. */
  negativeSince: Date;
  /** Whole days the account has been continuously negative. */
  negativeDays: number;
}

/**
 * Every account whose balance is negative right now, with the moment its
 * CURRENT run of debt began.
 *
 * "When did this go negative" is not a column and cannot be one: the balance is
 * a fold over the ledger, so the answer is found by replaying that fold in
 * order and taking the last row where the running total crossed from ≥ 0 into
 * < 0. Taking the FIRST such crossing would be wrong for an account that has
 * been negative, recovered, and gone negative again — it would date the debt
 * from a balance the customer already cleared, and charge interest on it.
 *
 * Accounts that are currently solvent are filtered out before the crossing is
 * joined, so a long ledger history costs nothing for the accounts that are fine.
 */
export async function negativeAccounts(pool: Pool): Promise<DebtPosition[]> {
  const { rows } = await pool.query<{ user_id: string; balance: string; since: Date }>(
    `WITH running AS (
       SELECT user_id,
              occurred_at,
              id,
              SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END)
                OVER (PARTITION BY user_id ORDER BY occurred_at, id
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
       FROM ledger_record
     ),
     crossings AS (
       SELECT user_id,
              occurred_at,
              balance,
              LAG(balance) OVER (PARTITION BY user_id ORDER BY occurred_at, id) AS previous
       FROM running
     ),
     owing AS (
       SELECT user_id,
              SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS balance
       FROM ledger_record
       GROUP BY user_id
       HAVING SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) < 0
     ),
     went_negative AS (
       SELECT user_id, MAX(occurred_at) AS since
       FROM crossings
       WHERE balance < 0 AND (previous IS NULL OR previous >= 0)
       GROUP BY user_id
     )
     SELECT o.user_id, o.balance::text AS balance, w.since
     FROM owing o
     JOIN went_negative w ON w.user_id = o.user_id`,
  );

  const now = Date.now();
  return rows.map((row) => {
    const balanceMinor = Number(row.balance);
    const since = new Date(row.since);
    return {
      userId: row.user_id,
      balanceMinor,
      debtMinor: Math.abs(balanceMinor),
      negativeSince: since,
      negativeDays: Math.floor((now - since.getTime()) / 86_400_000),
    };
  });
}
