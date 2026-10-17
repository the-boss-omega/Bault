import type { Pool } from 'pg';
import { log } from '../log';
import { reportAlert } from '../observability';

/**
 * Ledger invariant check.
 *
 * The wallet balance is DERIVED, so "balance == sum of ledger" holds by
 * construction. This monitor hunts for CORRUPTION that would undermine that:
 *   1. ledger rows with a non-positive amount (amount must be a positive minor unit),
 *   2. settled charges with NO backing ledger record (a billable action that
 *      escaped the ledger).
 *
 * A violation is logged at error level with the counts as fields and reported
 * to the error tracker when one is configured. Every hourly run that still
 * finds it reports it again on purpose, so a broken ledger keeps paging.
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
