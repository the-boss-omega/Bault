import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { loadEnv } from '@bault/config';
import * as schema from './schema';
import { StructuredLogger } from '../shared/observability/logger';

export type Database = NodePgDatabase<typeof schema>;

export function createDb(): { pool: Pool; db: Database } {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  pool.on('error', (err) => {
    new StructuredLogger('db').error(`idle database connection lost: ${err.message}`);
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
