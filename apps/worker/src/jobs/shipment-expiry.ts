import type { Pool } from 'pg';
import { log } from '../log';

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
