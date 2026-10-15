import { Pool } from 'pg';
import { log } from './log';

/**
 * The worker's connection pool.
 *
 * With an `error` listener, which is the whole reason this is a function (F063).
 * When Postgres restarts, every idle client in a pool receives an error and the
 * pool re-emits it as `error`. An EventEmitter with no listener for `error`
 * THROWS — from a socket callback, so as an uncaught exception — and the worker
 * died on a routine database restart, mid-job, exactly like a SIGKILL. The pool
 * has already thrown the broken client away by the time this fires and dials a
 * new one on the next query, so logging is all there is to do.
 */
export function createPool(connectionString: string, max?: number): Pool {
  const pool = new Pool({ connectionString, ...(max ? { max } : {}) });
  pool.on('error', (err) => {
    log.error('idle database connection lost', { error: err.message });
  });
  return pool;
}
