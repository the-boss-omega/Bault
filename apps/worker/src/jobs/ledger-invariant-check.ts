import type { Pool } from 'pg';
import { log } from '../log';
import { reportAlert } from '../observability';

/**
 * Ledger invariant check (T070, Principle IV).
 *
 * The wallet balance is DERIVED, so "balance == Σ ledger" holds by construction.
 * This continuous monitor instead hunts for CORRUPTION that would undermine that
 * guarantee, and alerts if any is found:
 *   1. ledger rows with a non-positive amount (amount must be a positive minor unit),
 *   2. settled charges with NO backing ledger record (a billable action that
 *      escaped the ledger).
 *
 * "Alerts" used to mean a plain-text line on stderr that nobody watches. A
 * violation is now logged at error level in the structured format — so a log
 * alert can match on `message` and read the counts as fields — and reported to
 * the error tracker when one is configured (step 15). Every hourly run that
 * still finds the violation reports it again; that is deliberate, because a
 * broken ledger that stops paging somebody after the first hour is a broken
 * ledger nobody is looking at.
 */
export async function checkLedgerInvariants(pool: Pool): Promise<void> {
  const badAmounts = await pool.query(`SELECT count(*)::int AS n FROM ledger_record WHERE amount <= 0`);
  const orphanCharges = await pool.query(
    `
    SELECT count(*)::int AS n
    FROM charge c
    WHERE c.status = 'settled'
      AND NOT EXISTS (
        SELECT 1 FROM ledger_record l
        WHERE l.reference_type = 'charge' AND l.reference_id = c.id::text
      )
    `,
  );

  const bad = badAmounts.rows[0]?.n ?? 0;
  const orphans = orphanCharges.rows[0]?.n ?? 0;

  const fields = { badAmountRows: bad, orphanSettledCharges: orphans };
  if (bad > 0 || orphans > 0) {
    log.error('ledger invariant violated', { job: 'ledger.invariant-check', ...fields });
    reportAlert('ledger invariant violated', fields, 'ledger.invariant-check');
  } else {
    log.info('ledger invariants hold', { job: 'ledger.invariant-check', ...fields });
  }
}
