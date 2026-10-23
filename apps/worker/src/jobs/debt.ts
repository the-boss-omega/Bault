import type { Pool } from 'pg';

export interface DebtPosition {
  userId: string;
  balanceMinor: number;
  debtMinor: number;
  negativeSince: Date;
  negativeDays: number;
}

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
