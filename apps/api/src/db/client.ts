import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { loadEnv } from '@bault/config';
import * as schema from './schema';
import { StructuredLogger } from '../shared/observability/logger';

/**
 * Drizzle client factory (T009).
 *
 * The API connects through the POOLED url (PgBouncer, 6432) — see .env.example.
 * `Database` is the fully-typed handle injected into every service via the
 * DRIZZLE token (see db.module.ts). `db.transaction(...)` is the single
 * transactional boundary that makes ownership + custody + money commit atomically.
 */
export type Database = NodePgDatabase<typeof schema>;

export function createDb(): { pool: Pool; db: Database } {
  const env = loadEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    // Server-side, so a runaway statement is cancelled by Postgres and releases
    // its locks, rather than merely abandoned by this process.
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
  });
  /**
   * A dropped idle connection is logged, not fatal (F063).
   *
   * When Postgres or PgBouncer restarts, every idle client in the pool gets an
   * error and the pool re-emits it as `error`. With no listener an EventEmitter
   * THROWS, from inside a socket callback — an uncaught exception, and the API
   * exited on a routine database restart. Verified by terminating the pool's
   * backends: the process died with "Unhandled 'error' event". The pool has
   * already discarded the broken client by the time this fires and opens a new
   * one on the next query, so there is nothing to do here but say so.
   */
  pool.on('error', (err) => {
    new StructuredLogger('db').error(`idle database connection lost: ${err.message}`);
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
