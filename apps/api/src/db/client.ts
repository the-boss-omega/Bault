import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { loadEnv } from '@bault/config';
import * as schema from './schema';

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
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
