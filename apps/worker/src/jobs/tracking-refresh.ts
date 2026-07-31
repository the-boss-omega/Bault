import type { Pool } from 'pg';
import { SandboxShippingAdapter } from '@bault/adapters';

/**
 * Shipment tracking refresh (T107). Polls the carrier (via the shipping adapter)
 * for every shipment that is out and updates its status. Runs in the worker so the
 * customer's tracking view stays current without a synchronous request. (A real
 * deployment may also receive carrier webhooks; polling is the fallback.)
 */
const shipping = new SandboxShippingAdapter();

export async function refreshTracking(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ id: string; tracking_number: string }>(
    `SELECT id, tracking_number FROM shipment
     WHERE status IN ('shipped', 'in_transit') AND tracking_number IS NOT NULL`,
  );

  for (const row of rows) {
    const status = await shipping.getTracking(row.tracking_number);
    const mapped =
      status.status === 'delivered' ? 'delivered' : status.status === 'exception' ? 'exception' : 'in_transit';
    await pool.query(`UPDATE shipment SET status = $1, updated_at = now() WHERE id = $2`, [mapped, row.id]);
  }
  // eslint-disable-next-line no-console
  console.log(`[job:tracking] refreshed ${rows.length} shipment(s)`);
}
