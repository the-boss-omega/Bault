import type { Pool } from 'pg';
import { log } from '../log';

/**
 * Release the items of shipments nobody paid for.
 *
 * A collector selects a service, cannot cover it, and the shipment is held in
 * `awaiting_payment` until `payment_due_at`. If the money never arrives, the
 * request ends so its cards can be put on another shipment.
 *
 * Nothing physical is undone, which is why this is safe to run unattended: an
 * item in an open shipment never left `stored` or its bin. Cancelling only hands
 * back its ability to be sent somewhere else. The outbox row it writes is what
 * tells the collector.
 *
 * `SKIP LOCKED`: a second run passes over the shipments the first is releasing
 * instead of queueing behind them, and a shipment the API is paying for right
 * now is left for the next run rather than cancelled out from under the payment.
 * Each row is updated in the transaction that locked it, and the
 * `status = 'awaiting_payment'` predicate means a shipment is never released twice.
 */
export async function expireUnpaidShipments(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{
      id: string;
      code: string | null;
      user_id: string;
      item_ids: unknown;
    }>(
      `SELECT id, code, user_id, item_ids
         FROM shipment
        WHERE status = 'awaiting_payment'
          AND payment_due_at IS NOT NULL
          AND payment_due_at <= now()
        FOR UPDATE SKIP LOCKED`,
    );

    for (const row of rows) {
      await client.query(
        `UPDATE shipment
            SET status = 'cancelled',
                cancelled_at = now(),
                cancel_reason = 'Not paid within the holding period',
                payment_due_at = NULL,
                updated_at = now()
          WHERE id = $1`,
        [row.id],
      );

      const itemCount = Array.isArray(row.item_ids) ? row.item_ids.length : 0;
      await client.query(
        `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload)
         VALUES ('shipment', $1, 'shipment_expired', $2::jsonb)`,
        [row.id, JSON.stringify({ userId: row.user_id, shipmentCode: row.code, itemCount })],
      );
    }

    await client.query('COMMIT');
    if (rows.length > 0) {
      log.info('unpaid shipments released', { job: 'shipment.expiry-sweep', released: rows.length });
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
