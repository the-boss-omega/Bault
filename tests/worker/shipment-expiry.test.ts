import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { expireUnpaidShipments } from '../../apps/worker/src/jobs/shipment-expiry';
import { count, createUser, testPool } from './helpers/db';

/**
 * Releasing shipments nobody paid for, run more than once.
 *
 * One cancelled shipment and one `shipment_expired` message per shipment, no
 * matter how many runs saw it.
 */
let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

async function overdue(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO shipment (user_id, item_ids, destination_address, status, payment_due_at)
     VALUES ($1, '[]'::jsonb, 'Worker suite, 1 Test Street', 'awaiting_payment', now() - interval '1 hour')
     RETURNING id`,
    [await createUser(pool)],
  );
  return rows[0]!.id;
}

const messages = (pool: Pool, id: string) =>
  count(pool, `SELECT 1 FROM outbox_message WHERE event_type = 'shipment_expired' AND aggregate_id = $1`, [id]);

describe('shipment expiry', () => {
  it('releases a shipment once when run twice in a row', async () => {
    const id = await overdue(pool);
    await expireUnpaidShipments(pool);
    await expireUnpaidShipments(pool);
    expect(await messages(pool, id)).toBe(1);
  });

  it('releases a shipment once when two runs overlap', async () => {
    const id = await overdue(pool);
    await Promise.all([expireUnpaidShipments(pool), expireUnpaidShipments(pool)]);
    expect(await messages(pool, id)).toBe(1);
    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM shipment WHERE id = $1`, [id]);
    expect(rows[0]!.status).toBe('cancelled');
  });
});
