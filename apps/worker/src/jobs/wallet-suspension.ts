import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { negativeAccounts } from './debt';

/**
 * Wallet debt suspension sweep.
 *
 * A negative balance already blocks the individual actions that spend money
 * (`WalletService.assertNotBlocked` refuses new shipments and service requests).
 * That is a per-action brake with no escalation: an account $2 down and an
 * account $2,000 down were treated identically, forever.
 *
 * This sweep adds the escalation. Below `WALLET_SUSPEND_BELOW_MINOR` the
 * account is SUSPENDED, which `SessionAuthGuard` enforces on every request and
 * `AuthService.login` enforces at sign-in — so the account is closed to its
 * holder rather than merely restricted. When the debt clears, the sweep lifts
 * the suspension again.
 *
 * Two design points worth stating plainly:
 *
 *  - Only suspensions this sweep imposed are ever lifted. `auto_suspended_at`
 *    is the marker; an administrator's suspension has no marker and survives
 *    the balance recovering, because it was a judgement about a person and not
 *    about a number.
 *
 *  - A suspended holder cannot sign in, and therefore cannot raise the cash-in
 *    request that would clear their own debt. That is deliberate and matches
 *    the reference service, but it means recovery is somebody else's action: an
 *    administrator completing a cash-in on their behalf, or money arriving on
 *    its own (a listing of theirs selling credits the ledger while they are
 *    locked out). Either way the next sweep sees the balance and reinstates
 *    them without anyone having to remember to.
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
  // sweep is holding, not over `positions` — an account that has recovered is
  // no longer negative at all, so it does not appear there.
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

  // eslint-disable-next-line no-console
  console.log(
    `[job:wallet-suspension] threshold ${threshold} minor units — suspended ${suspended}, reinstated ${reinstated}`,
  );
}
