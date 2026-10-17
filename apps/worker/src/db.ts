import { Pool } from 'pg';
import { log } from './log';

/**
 * The worker's connection pool, with an `error` listener.
 *
 * When Postgres restarts, every idle client errors and the pool re-emits it as
 * `error`. With no listener that is an uncaught exception and the worker dies
 * mid-job. The pool has already discarded the broken client and dials a new one
 * on the next query, so logging is all there is to do.
 */
export function createPool(connectionString: string, max?: number): Pool {
  const pool = new Pool({ connectionString, ...(max ? { max } : {}) });
  pool.on('error', (err) => {
    log.error('idle database connection lost', { error: err.message });
  });
  return pool;
}
