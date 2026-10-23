import type { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import { createShippingAdapter, type ShippingAdapter, type TrackingStatus } from '@bault/adapters';
import { log } from '../log';

const PER_RUN = 200;
const MOVABLE = ['shipped', 'in_transit'];

let configured: ShippingAdapter | undefined;
function carrier(): ShippingAdapter {
  return (configured ??= createShippingAdapter(loadEnv()));
}

const ANNOUNCED: Record<string, string> = {
  delivered: 'shipment_delivered',
  exception: 'shipment_exception',
};

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
      const locked = await client.query<{ status: string; user_id: string; code: string | null }>(
        `SELECT status, user_id, code FROM shipment
          WHERE id = $1 AND status = ANY($2::shipment_status[])
          FOR UPDATE SKIP LOCKED`,
        [row.id, MOVABLE],
      );
      const current = locked.rows[0];
      if (current) {
        await client.query(
          `UPDATE shipment SET status = COALESCE($1::shipment_status, status), updated_at = now() WHERE id = $2`,
          [next, row.id],
        );
        if (next && next !== current.status) {
          moved += 1;
          const eventType = ANNOUNCED[next];
          if (eventType) {
            await client.query(
              `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload)
               VALUES ('shipment', $1, $2, $3::jsonb)`,
              [
                row.id,
                eventType,
                JSON.stringify({ userId: current.user_id, shipmentCode: current.code, trackingNumber: row.tracking_number }),
              ],
            );
          }
        }
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
