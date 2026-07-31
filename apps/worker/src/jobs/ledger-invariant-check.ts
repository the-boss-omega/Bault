import type { Pool } from 'pg';

/**
 * Ledger invariant check (T070, Principle IV).
 *
 * The wallet balance is DERIVED, so "balance == Σ ledger" holds by construction.
 * This continuous monitor instead hunts for CORRUPTION that would undermine that
 * guarantee, and alerts (logs at error level) if any is found:
 *   1. ledger rows with a non-positive amount (amount must be a positive minor unit),
 *   2. settled charges with NO backing ledger record (a billable action that
 *      escaped the ledger).
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

  if (bad > 0 || orphans > 0) {
    // eslint-disable-next-line no-console
    console.error(`[job:ledger-invariant] ALERT bad_amount_rows=${bad} orphan_settled_charges=${orphans}`);
  } else {
    // eslint-disable-next-line no-console
    console.log('[job:ledger-invariant] ok');
  }
}
