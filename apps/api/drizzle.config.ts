import { defineConfig } from 'drizzle-kit';
import { loadEnv } from '@bault/config';

const env = loadEnv();

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: env.DIRECT_DATABASE_URL },
});
