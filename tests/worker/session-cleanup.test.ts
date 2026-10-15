import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { purgeExpiredSessions } from '../../apps/worker/src/jobs/session-cleanup';
import { JobName } from '../../apps/worker/src/jobs/registry';
import { createUser, testPool } from './helpers/db';

/**
 * Expired sign-in sessions are deleted a month after they stop working.
 *
 * Nothing removed them, so `login_session` grew by one row per sign-in forever,
 * each holding a token hash for a session nobody could use. A month is kept so
 * "was that me?" still has an answer for recent activity; the permanent record
 * of who signed in is `login_attempt`, which is append-only and untouched here.
 */
let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

async function session(pool: Pool, userId: string, expiresDaysFromNow: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO login_session (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3::int)) RETURNING id`,
    [userId, randomBytes(16).toString('hex'), expiresDaysFromNow],
  );
  return rows[0]!.id;
}

const exists = async (pool: Pool, id: string) =>
  (await pool.query(`SELECT 1 FROM login_session WHERE id = $1`, [id])).rowCount === 1;

describe('session cleanup', () => {
  it('is a registered job', () => {
    expect(Object.values(JobName)).toContain('session.cleanup');
  });

  it('deletes sessions that expired more than 30 days ago, and nothing else', async () => {
    const user = await createUser(pool);
    const ancient = await session(pool, user, -31);
    const recent = await session(pool, user, -29);
    const live = await session(pool, user, 7);

    await purgeExpiredSessions(pool);
    await purgeExpiredSessions(pool);

    expect(await exists(pool, ancient)).toBe(false);
    expect(await exists(pool, recent)).toBe(true);
    expect(await exists(pool, live)).toBe(true);
  });
});
