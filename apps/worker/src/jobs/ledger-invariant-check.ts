import type { Pool } from 'pg';
import { log } from '../log';
import { reportAlert } from '../observability';

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
