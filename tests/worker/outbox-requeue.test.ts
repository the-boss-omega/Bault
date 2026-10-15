import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { MAX_ATTEMPTS, dispatchOutbox } from '../../apps/worker/src/jobs/outbox-dispatch';
import { SEED, signIn } from '../integration/helpers/http';
import { count, createUser, testPool, warm } from './helpers/db';

/**
 * A parked message, requeued by an administrator, delivered exactly once.
 *
 * The dispatcher gives up on a message after `MAX_ATTEMPTS` failures and leaves
 * it for a person. The API's requeue is how that person hands it back. What
 * this pins is the whole round trip the way it runs: the row is parked, the
 * dispatcher leaves it alone, the requeue goes through the real API route, and
 * then the dispatcher — run twice at once, as a second replica would — delivers
 * it once.
 *
 * Needs the API running.
 */
let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

const notificationsFor = (userId: string) => count(pool, `SELECT 1 FROM notification WHERE user_id = $1`, [userId]);

describe('requeueing a parked outbox message', () => {
  it('uses the same threshold the dispatcher parks at', async () => {
    // Mirrored by value — the worker does not import the API — so pinned here.
    const { PARKED_AFTER_ATTEMPTS } = await import('../../apps/api/src/modules/adm/outbox-parking');
    expect(PARKED_AFTER_ATTEMPTS).toBe(MAX_ATTEMPTS);
  });

  it('is left alone while parked, and delivered exactly once after the requeue', async () => {
    const user = await createUser(pool);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload, attempts, last_error, last_attempt_at)
       VALUES ('item', 'requeue-worker-test', 'item_donated', $1::jsonb, $2, 'mail server was down', now())
       RETURNING id`,
      [JSON.stringify({ userId: user }), MAX_ATTEMPTS],
    );
    const id = rows[0]!.id;

    // Parked: the dispatcher does not touch it.
    await dispatchOutbox(pool);
    expect(await notificationsFor(user)).toBe(0);

    const admin = await signIn(SEED.admin);
    const res = await admin.post(`/admin/outbox/${id}/requeue`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // Two dispatchers at once, then a third run for good measure.
    await warm(pool);
    await Promise.all([dispatchOutbox(pool), dispatchOutbox(pool)]);
    await dispatchOutbox(pool);

    expect(await notificationsFor(user)).toBe(1);
    const { rows: after } = await pool.query<{ dispatched_at: Date | null }>(
      `SELECT dispatched_at FROM outbox_message WHERE id = $1`,
      [id],
    );
    expect(after[0]!.dispatched_at).not.toBeNull();
    // Delivered, so there is nothing left to requeue.
    expect((await admin.post(`/admin/outbox/${id}/requeue`)).status).toBe(409);
  });
});
