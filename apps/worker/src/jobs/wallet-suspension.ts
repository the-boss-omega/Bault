import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { log } from '../log';
import { negativeAccounts } from './debt';

/**
 * Wallet debt suspension sweep.
 *
 * A negative balance already blocks the individual actions that spend money
 * (`WalletService.assertNotBlocked` refuses new shipments and service requests).
 * This sweep adds the escalation. Below `WALLET_SUSPEND_BELOW_MINOR` the account
 * is SUSPENDED: it can still sign in, but `SessionAuthGuard` refuses every route
 * except those marked `@AllowSuspended()` (the helpdesk and the profile probe).
 * When the balance is back at or above the threshold, the sweep lifts the
 * suspension again.
 *
 *  - Only suspensions this sweep imposed are ever lifted. `auto_suspended_at`
 *    is the marker; an administrator's suspension has no marker and survives
 *    the balance recovering, because it was a judgement about a person and not
 *    about a number. Any status an administrator sets clears the marker, so a
 *    suspension made by hand after one of the sweep's own is not mistaken for it.
 *
 *  - Both updates are single statements whose predicates re-check the status,
 *    so running the sweep twice, or twice at once, changes nothing the second
 *    time.
 *
 *  - A suspended holder cannot raise the cash-in request that would clear their
 *    own debt, so recovery is somebody else's action: an administrator
 *    completing a cash-in on their behalf, or money arriving on its own (a
 *    listing of theirs selling). Either way the next sweep sees the balance and
 *    reinstates them.
 */
export async function sweepWalletSuspensions(pool: Pool): Promise<void> {
  const threshold = loadEnv().WALLET_SUSPEND_BELOW_MINOR;

  const positions = await negativeAccounts(pool);
  const overThreshold = positions.filter((p) => p.balanceMinor < threshold).map((p) => p.userId);

  let suspended = 0;
  if (overThreshold.length > 0) {
    // `status = 'active'` in the predicate is what makes this idempotent and
    // what keeps it off accounts that are pending, closed, or already suspended
    // by a person.
    const result = await pool.query(
      `UPDATE user_account
          SET status = 'suspended', auto_suspended_at = now()
        WHERE id = ANY($1::uuid[])
          AND status = 'active'`,
      [overThreshold],
    );
    suspended = result.rowCount ?? 0;
  }

  // Reinstatement is computed over the CURRENT balance of the accounts this
  // sweep suspended, not over `positions`: an account that has recovered may no
  // longer be negative at all, so it would not appear there.
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
