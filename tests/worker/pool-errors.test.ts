import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { BASE } from '../integration/helpers/http';
import { testPool } from './helpers/db';

/**
 * A database restart must not kill the processes that use it (F063).
 *
 * When Postgres or PgBouncer restarts, every idle connection a `pg` Pool is
 * holding gets an error, and the pool re-emits it as an `error` event. An
 * EventEmitter with no `error` listener THROWS, and here that throw happens in a
 * socket callback — an uncaught exception, and the process exits. A routine
 * database restart took the whole API down with it, and the worker too.
 *
 * Simulated here the way it happens: the server ends the backends. Only this
 * database's backends, and never this test's own.
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

const terminateIdleBackends = (pool: Pool) =>
  pool.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'idle'`,
  );

const readyz = async () => {
  try {
    return (await fetch(`${BASE}/readyz`)).status;
  } catch (err) {
    return `unreachable: ${(err as Error).message}`;
  }
};

describe('when the database drops idle connections', () => {
  it('the API stays up and serves the next request', async () => {
    // Make sure the API's pool is holding idle connections to be dropped.
    await Promise.all(Array.from({ length: 5 }, () => fetch(`${BASE}/readyz`)));
    await terminateIdleBackends(pool);
    await new Promise((r) => setTimeout(r, 500));
    expect(await readyz()).toBe(200);
  });

  it("the worker's pool survives it too", async () => {
    const { createPool } = await import('../../apps/worker/src/db');
    const { loadEnv } = await import('@bault/config');
    const worker = createPool(loadEnv().DIRECT_DATABASE_URL);
    try {
      // Without a listener the dropped connection below is an uncaught
      // exception, and vitest reports it as such.
      expect(worker.listenerCount('error')).toBeGreaterThan(0);
      await worker.query('select 1');
      await terminateIdleBackends(pool);
      await new Promise((r) => setTimeout(r, 300));
      const { rows } = await worker.query<{ ok: number }>('select 1 AS ok');
      expect(rows[0]!.ok).toBe(1);
    } finally {
      await worker.end();
    }
  });
});
