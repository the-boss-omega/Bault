import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { log } from '../log';
import { negativeAccounts } from './debt';

export async function accrueInterest(pool: Pool): Promise<void> {
  const env = loadEnv();
  const graceDays = env.WALLET_DEBT_GRACE_DAYS;
  const bps = env.WALLET_DEBT_INTEREST_BPS;

  if (bps === 0) {
    log.info('interest rate is 0 bps — nothing to accrue', { job: 'interest.accrual' });
    return;
  }

  const { rows: today } = await pool.query<{ day: string }>(
    `SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day`,
  );
  const key = `interest:${today[0]!.day}`;

  const positions = await negativeAccounts(pool);
  const due = positions.filter((p) => p.negativeDays >= graceDays);

  let charged = 0;
  let skipped = 0;
  let errored = 0;
  for (const position of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`wallet:${position.userId}`]);

      const { rows } = await client.query<{ status: string | null; balance: string }>(
        `SELECT (SELECT status::text FROM user_account WHERE id::text = $1) AS status,
                coalesce(sum(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::text AS balance
           FROM ledger_record
          WHERE user_id = $1`,
        [position.userId],
      );
      const status = rows[0]?.status;
      const balance = Number(rows[0]?.balance ?? 0);
      if (status === 'closed' || status === 'pending' || balance >= 0) {
        await client.query('ROLLBACK');
        skipped += 1;
        continue;
      }

      const amount = Math.max(1, Math.floor((-balance * bps) / 10_000));
      const inserted = await client.query(
        `INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type, reference_id)
         VALUES ($1, 'interest', $2::bigint, 'debit', 'USD', 'interest', $3)
         ON CONFLICT (user_id, reference_id) WHERE type = 'interest' DO NOTHING`,
        [position.userId, amount, key],
      );
      await client.query('COMMIT');
      if ((inserted.rowCount ?? 0) > 0) charged += 1;
      else skipped += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      errored += 1;
      log.error('interest accrual failed for one account', {
        job: 'interest.accrual',
        userId: position.userId,
        error: err,
      });
    } finally {
      client.release();
    }
  }

  log.info('interest accrued', {
    job: 'interest.accrual',
    day: key,
    negative_accounts: positions.length,
    past_grace: due.length,
    grace_days: graceDays,
    charged,
    skipped,
    errored,
  });
  if (errored > 0) throw new Error(`interest accrual failed for ${errored} account(s)`);
}
