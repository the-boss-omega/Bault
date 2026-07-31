import { defineConfig } from 'drizzle-kit';
import { loadEnv } from '@bault/config';

/**
 * drizzle-kit config (T009). Migrations run over the DIRECT connection (5432,
 * bypassing PgBouncer) because DDL and advisory locks need a real session.
 */
const env = loadEnv();

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: env.DIRECT_DATABASE_URL },
  // Custom SQL (append-only role + guard triggers) is applied by migrate.ts after
  // the generated migrations; see src/db/sql/0001_append_only.sql.
});
