import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { createShippingAdapter, type ShippingAdapter, type TrackingStatus } from '@bault/adapters';
import { log } from '../log';

/**
 * Shipment tracking refresh (T107). Polls the carrier (via the shipping adapter)
 * for every shipment that is out and updates its status. Runs in the worker so the
 * customer's tracking view stays current without a synchronous request. (A real
 * deployment may also receive carrier webhooks; polling is the fallback.)
 *
 * THE CARRIER THE DEPLOYMENT IS CONFIGURED FOR (E17, F039). This built
 * `new SandboxShippingAdapter()` itself, whatever `SHIPPING_PROVIDER` said, and
 * the sandbox answers `in_transit` for every parcel forever: in production with
 * EasyPost, no shipment would ever have reached `delivered`. The adapter is now
 * chosen by the same factory the API uses, from the same config, with the same
 * refusal of the sandbox in production.
 *
 * ONE PARCEL AT A TIME (F050). A carrier error on one tracking number escaped
 * the loop and nothing after it was refreshed, every half hour, for as long as
 * that one kept failing. Each parcel is now its own attempt. The carrier is
 * asked OUTSIDE any transaction — a row lock is not held across a network call —
 * and the answer is then written under `FOR UPDATE SKIP LOCKED`, only if the
 * shipment is still in a status this job is allowed to move. A parcel an
 * operator has just marked delivered by hand is not dragged back to
 * `in_transit` by an answer that was already on its way.
 *
 * A status the carrier reports that maps to nothing (`unknown`) changes nothing,
 * where it used to be written as `in_transit`.
 *
 * Bounded per run, least recently refreshed first, so a backlog is worked
 * through over successive runs instead of in one unbounded burst of carrier
 * calls.
 */
const PER_RUN = 200;
const MOVABLE = ['shipped', 'in_transit'];

let configured: ShippingAdapter | undefined;
function carrier(): ShippingAdapter {
  return (configured ??= createShippingAdapter(loadEnv()));
}

function nextStatus(tracking: TrackingStatus): string | null {
  switch (tracking.status) {
    case 'delivered':
    case 'exception':
    case 'in_transit':
      return tracking.status;
    default:
      return null;
  }
}

export async function refreshTracking(pool: Pool, shipping: ShippingAdapter = carrier()): Promise<void> {
  const { rows } = await pool.query<{ id: string; tracking_number: string }>(
    `SELECT id, tracking_number FROM shipment
      WHERE status = ANY($1::shipment_status[]) AND tracking_number IS NOT NULL
      ORDER BY updated_at ASC
      LIMIT $2`,
    [MOVABLE, PER_RUN],
  );

  let moved = 0;
  let failed = 0;
  for (const row of rows) {
    let next: string | null;
    try {
      next = nextStatus(await shipping.getTracking(row.tracking_number));
    } catch (err) {
      failed += 1;
      log.warn('carrier lookup failed; the parcel is retried next run', {
        job: 'shipment.tracking-refresh',
        shipmentId: row.id,
        error: (err as Error).message,
      });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ status: string }>(
        `SELECT status FROM shipment
          WHERE id = $1 AND status = ANY($2::shipment_status[])
          FOR UPDATE SKIP LOCKED`,
        [row.id, MOVABLE],
      );
      const current = locked.rows[0];
      if (current) {
        // `updated_at` moves either way, so the next run starts with the
        // parcels that have waited longest.
        await client.query(
          `UPDATE shipment SET status = COALESCE($1::shipment_status, status), updated_at = now() WHERE id = $2`,
          [next, row.id],
        );
        if (next && next !== current.status) moved += 1;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      failed += 1;
      log.error('could not record a tracking update', {
        job: 'shipment.tracking-refresh',
        shipmentId: row.id,
        error: err,
      });
    } finally {
      client.release();
    }
  }

  log.info('tracking refreshed', { job: 'shipment.tracking-refresh', polled: rows.length, moved, failed });
}
