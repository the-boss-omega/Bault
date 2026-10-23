import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { dispatchOutbox } from '../../apps/worker/src/jobs/outbox-dispatch';
import { count, createUser, testPool } from './helpers/db';

let pool: Pool;
const poisoned: string[] = [];
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
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
    await Promise.all([dispatchOutbox(pool), dispatchOutbox(pool)]);
    expect(await undispatched(pool, ids)).toBe(0);
    expect(await notificationsFor(pool, user)).toBe(20);
  });

  it('does not let one message that fails stop the ones behind it (N29)', async () => {
    const user = await createUser(pool);
    const bad = await emit(pool, 'item_received', { userId: 'not-a-uuid' });
    poisoned.push(bad);
    const good = [];
    for (let i = 0; i < 3; i += 1) good.push(await emit(pool, 'item_donated', { userId: user }));

    await dispatchOutbox(pool);

    expect(await undispatched(pool, good)).toBe(0);
    expect(await notificationsFor(pool, user)).toBe(3);

    const { rows } = await pool.query<{ dispatched_at: Date | null; attempts: number; last_error: string | null }>(
      `SELECT dispatched_at, attempts, last_error FROM outbox_message WHERE id = $1`,
      [bad],
    );
    expect(rows[0]!.dispatched_at).toBeNull();
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.last_error).toMatch(/uuid/i);
    expect(await count(pool, `SELECT 1 FROM notification WHERE user_id = 'not-a-uuid'`)).toBe(0);
  });
});

describe('dispatching a password reset', () => {
  const emailOf = async (pool: Pool, userId: string) =>
    (await pool.query<{ email: string }>(`SELECT email FROM user_account WHERE id = $1`, [userId])).rows[0]!.email;
  const validTokens = (pool: Pool, userId: string) =>
    count(
      pool,
      `SELECT 1 FROM verification_token
        WHERE user_id = $1 AND type = 'password_reset' AND consumed_at IS NULL AND expires_at > now()`,
      [userId],
    );

  it('leaves one valid link, not two, when the dispatch that minted the first fails to commit', async () => {
    const user = await createUser(pool);
    const email = await emailOf(pool, user);
    const id = await emit(pool, 'password_reset_requested', { email });

    await pool.query(`CREATE SEQUENCE IF NOT EXISTS wk_reset_dispatch_failure`);
    await pool.query(`
      CREATE OR REPLACE FUNCTION wk_fail_reset_dispatch_once() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.id = '${id}'::uuid AND NEW.dispatched_at IS NOT NULL AND OLD.dispatched_at IS NULL
           AND nextval('wk_reset_dispatch_failure') = 1 THEN
          RAISE EXCEPTION 'simulated failure before commit';
        END IF;
        RETURN NEW;
      END $fn$`);
    await pool.query(`DROP TRIGGER IF EXISTS wk_fail_reset_dispatch ON outbox_message`);
    await pool.query(
      `CREATE TRIGGER wk_fail_reset_dispatch BEFORE UPDATE ON outbox_message
         FOR EACH ROW EXECUTE FUNCTION wk_fail_reset_dispatch_once()`,
    );
    try {
      await dispatchOutbox(pool);
      expect(await undispatched(pool, [id])).toBe(1);
      await dispatchOutbox(pool);
      expect(await undispatched(pool, [id])).toBe(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS wk_fail_reset_dispatch ON outbox_message`);
      await pool.query(`DROP FUNCTION IF EXISTS wk_fail_reset_dispatch_once()`);
      await pool.query(`DROP SEQUENCE IF EXISTS wk_reset_dispatch_failure`);
    }

    expect(await validTokens(pool, user)).toBe(1);
  });

  it('sends no link to a closed account', async () => {
    const user = await createUser(pool, 'closed');
    const id = await emit(pool, 'password_reset_requested', { email: await emailOf(pool, user) });
    await dispatchOutbox(pool);
    expect(await undispatched(pool, [id])).toBe(0);
    expect(await validTokens(pool, user)).toBe(0);
  });
});
