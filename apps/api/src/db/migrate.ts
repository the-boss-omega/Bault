import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '@bault/config';

/**
 * Migration runner (T009 + T011).
 *
 * Order matters:
 *   1. Apply drizzle-kit generated schema migrations (tables, enums, indexes).
 *   2. Apply the append-only guards SQL AFTER the tables exist, so the triggers
 *      and role grants attach to the freshly-created history tables.
 *
 * Runs over the DIRECT connection (5432, not PgBouncer) — DDL needs a real session.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DIRECT_DATABASE_URL });
  const db = drizzle(pool);

  await migrate(db, { migrationsFolder: './src/db/migrations' });

  await pool.query(readFileSync(appendOnlySqlPath(), 'utf8'));

  await pool.end();
  // eslint-disable-next-line no-console
  console.log('✔ migrations applied and append-only guards installed');
}

/**
 * Where the append-only guards live.
 *
 * Next to this file when it runs from source (`tsx src/db/migrate.ts`). But the
 * API image runs the COMPILED migrator from `dist/db/`, and the SQL is not
 * compiled — the image copies it to `src/db/sql/`, alongside the migrations
 * (which `migrate` already reads relative to the working directory). Looking
 * only beside `__dirname` meant a Docker deploy migrated the schema and then
 * failed to install the triggers that make history append-only. Both places
 * are tried, and a clear error names them if neither has the file.
 */
function appendOnlySqlPath(): string {
  const candidates = [
    join(__dirname, 'sql', '0001_append_only.sql'),
    join(process.cwd(), 'src', 'db', 'sql', '0001_append_only.sql'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`0001_append_only.sql not found; looked in: ${candidates.join(', ')}`);
  return found;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('migration failed', err);
  process.exit(1);
});
