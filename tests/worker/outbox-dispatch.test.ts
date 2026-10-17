import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { dispatchOutbox } from '../../apps/worker/src/jobs/outbox-dispatch';
import { count, createUser, testPool } from './helpers/db';

/**
 * Outbox dispatch: each message exactly once, and none stuck behind a bad one.
 *
 * `item_donated` is used because it is in-app only by default: one outbox row
 * becomes exactly one notification, so the count is the whole story.
 */
let pool: Pool;
const poisoned: string[] = [];
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  // Leave nothing behind that the next run would keep retrying.
  if (poisoned.length > 0) {
    await pool.query(`UPDATE outbox_message SET dispatched_at = now() WHERE id = ANY($1::uuid[])`, [poisoned]);
  }
  await pool.end();
});

async function emit(pool: Pool, eventType: string, payload: Record<string, unknown>): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload)
     VALUES ('item', 'worker-test', $1, $2::jsonb) RETURNING id`,
    [eventType, JSON.stringify(payload)],
  );
  return rows[0]!.id;
}

const notificationsFor = (pool: Pool, userId: string) =>
  count(pool, `SELECT 1 FROM notification WHERE user_id = $1`, [userId]);
const undispatched = (pool: Pool, ids: string[]) =>
  count(pool, `SELECT 1 FROM outbox_message WHERE id = ANY($1::uuid[]) AND dispatched_at IS NULL`, [ids]);

describe('dispatching the outbox', () => {
  it('delivers each message once when the job runs twice', async () => {
    const user = await createUser(pool);
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push(await emit(pool, 'item_donated', { userId: user }));
    await dispatchOutbox(pool);
    await dispatchOutbox(pool);
    expect(await undispatched(pool, ids)).toBe(0);
    expect(await notificationsFor(pool, user)).toBe(5);
  });

  it('delivers each message exactly once when two dispatchers run at the same time', async () => {
    const user = await createUser(pool);
    const ids = [];
    for (let i = 0; i < 20; i += 1) ids.push(await emit(pool, 'item_donated', { userId: user }));
    // A second replica, or a run still going when the next minute's starts,
    // must not work through the same rows and notify everybody twice.
    await Promise.all([dispatchOutbox(pool), dispatchOutbox(pool)]);
    expect(await undispatched(pool, ids)).toBe(0);
    expect(await notificationsFor(pool, user)).toBe(20);
  });

  it('does not let one message that fails stop the ones behind it (N29)', async () => {
    const user = await createUser(pool);
    // A recipient id that is not a uuid makes the account lookup for the email
    // channel throw. Any row that throws will do; this is one that really can.
    const bad = await emit(pool, 'item_received', { userId: 'not-a-uuid' });
    poisoned.push(bad);
    const good = [];
    for (let i = 0; i < 3; i += 1) good.push(await emit(pool, 'item_donated', { userId: user }));

    await dispatchOutbox(pool);

    // A throw that escaped the loop would leave everything after the bad row
    // undispatched, and every minute's retry would hit the same row first,
    // stopping the outbox for everybody.
    expect(await undispatched(pool, good)).toBe(0);
    expect(await notificationsFor(pool, user)).toBe(3);

    // The bad row is kept, with what went wrong and how often.
    const { rows } = await pool.query<{ dispatched_at: Date | null; attempts: number; last_error: string | null }>(
      `SELECT dispatched_at, attempts, last_error FROM outbox_message WHERE id = $1`,
      [bad],
    );
    expect(rows[0]!.dispatched_at).toBeNull();
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.last_error).toMatch(/uuid/i);
    // And what it half-did was rolled back with it, so a retry cannot stack
    // up duplicate in-app rows.
    expect(await count(pool, `SELECT 1 FROM notification WHERE user_id = 'not-a-uuid'`)).toBe(0);
  });
});
