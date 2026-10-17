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
  /**
   * No session settings here. `pg` sends options such as `statement_timeout`
   * as startup parameters, and PgBouncer closes a connection that carries one
   * ("unsupported startup parameter"). A `SET` per connection does not work
   * either: in transaction mode the next transaction may run on another server
   * connection. The statement timeout is a setting of the database role
   * (infra/production/roles.sql), or of the database in development and CI
   * (infra/postgres/dev-settings.sql), so Postgres applies it at every login.
   */
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  /**
   * A dropped idle connection is logged, not fatal.
   *
   * When Postgres or PgBouncer restarts, every idle client in the pool gets an
   * error and the pool re-emits it as `error`. With no listener an EventEmitter
   * THROWS, from inside a socket callback, and the process exits. The pool has
   * already discarded the broken client by the time this fires and opens a new
   * one on the next query, so there is nothing to do here but say so.
   */
  pool.on('error', (err) => {
    new StructuredLogger('db').error(`idle database connection lost: ${err.message}`);
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
