import { readFileSync } from 'node:fs';
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

  /**
   * Read next to this file, which is `dist/db/sql` once compiled.
   *
   * It used to be absent there: `nest build` compiles TypeScript and copies
   * nothing else, so in the image the drizzle migrations above applied and this
   * line then failed with ENOENT. The database was left with every table, no
   * append-only trigger, no guard against deleting an item and no uuid/text
   * operators. `nest-cli.json` now copies `src/db/sql/*.sql` into `dist` as a
   * build asset, so the compiled runner and `tsx src/db/migrate.ts` read the
   * same file.
   */
  const appendOnlySql = readFileSync(join(__dirname, 'sql', '0001_append_only.sql'), 'utf8');
  await pool.query(appendOnlySql);

  await pool.end();
  // eslint-disable-next-line no-console
  console.log('✔ migrations applied and append-only guards installed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('migration failed', err);
  process.exit(1);
});
