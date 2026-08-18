import type { Pool } from 'pg';

/**
 * Release the items of shipments nobody paid for.
 *
 * A collector selects a service, cannot cover it, and the shipment is held in
 * `awaiting_payment` for a week. If the money never arrives, the request has to
 * end — otherwise the parcel sits open forever, its cards cannot be put on
 * another shipment, and the collector is left with a request they cannot cancel
 * because they have forgotten it exists.
 *
 * Nothing physical is undone, which is the reason this is safe to run
 * unattended: an item in an open shipment never left `stored` and never left its
 * bin. What being in an open shipment costs it is the ability to be sent
 * somewhere else, and cancelling the shipment is exactly what hands that back.
 *
 * Raw SQL rather than the API's service, like every other worker job — the
 * worker is deliberately independent of the Nest container, and the outbox row
 * it writes is what tells the collector.
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
        FOR UPDATE`,
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
      console.log(`[shipment-expiry] released ${rows.length} unpaid shipment(s)`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
