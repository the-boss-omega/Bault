import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { log } from '../log';
import { negativeAccounts } from './debt';

export async function sweepWalletSuspensions(pool: Pool): Promise<void> {
  const threshold = loadEnv().WALLET_SUSPEND_BELOW_MINOR;

  const positions = await negativeAccounts(pool);
  const overThreshold = positions.filter((p) => p.balanceMinor < threshold).map((p) => p.userId);

  let suspended = 0;
  if (overThreshold.length > 0) {
    const result = await pool.query(
      `UPDATE user_account
          SET status = 'suspended', auto_suspended_at = now()
        WHERE id = ANY($1::uuid[])
          AND status = 'active'`,
      [overThreshold],
    );
    suspended = result.rowCount ?? 0;
  }

  const reinstateResult = await pool.query(
    `WITH balances AS (
       SELECT user_id,
              SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS balance
       FROM ledger_record
       GROUP BY user_id
     )
     UPDATE user_account u
        SET status = 'active', auto_suspended_at = NULL
       FROM balances b
      WHERE b.user_id = u.id::text
        AND u.status = 'suspended'
        AND u.auto_suspended_at IS NOT NULL
        AND b.balance >= $1::bigint`,
    [threshold],
  );
  const reinstated = reinstateResult.rowCount ?? 0;

  log.info('wallet suspensions swept', {
    job: 'wallet.suspension-sweep',
    threshold_minor: threshold,
    suspended,
    reinstated,
  });
}
