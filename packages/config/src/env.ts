import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Load the nearest `.env` by walking up from the current working directory. In
 * this monorepo the apps run from `apps/<name>` but `.env` lives at the repo root,
 * so a plain `dotenv.config()` (which looks in cwd) would miss it. CI sets env
 * vars directly, so a missing file is fine — process.env already has the values.
 */
function loadDotenvFromRoot(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv(); // fallback to default behavior (harmless if no file)
}

/**
 * Environment schema + loader (T007).
 *
 * WHY a schema: reading `process.env.FOO` scattered across the code makes missing
 * or malformed config a runtime surprise. Here we declare EVERY variable once,
 * validate it at startup, and export a fully-typed, frozen object. If a required
 * var is missing the process refuses to boot with a clear message — fail fast.
 *
 * Secrets themselves are NEVER hard-coded: this only reads them from the
 * environment (Constitution Principle IX). `.env.example` documents the shape.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),

  // Pooled URL for the API (PgBouncer, 6432); direct URL for migrations & pg-boss (5432).
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url(),

  // Sessions (ACC)
  SESSION_COOKIE_SECRET: z.string().min(16, 'SESSION_COOKIE_SECRET must be at least 16 chars'),
  SESSION_COOKIE_NAME: z.string().default('session'),

  // Object storage (item images)
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string(),
  STORAGE_BUCKET: z.string(),
  STORAGE_ACCESS_KEY: z.string(),
  STORAGE_SECRET_KEY: z.string(),

  // External providers — optional in dev (empty string allowed), required in prod
  // is enforced by the individual adapters when they are actually used (T020+).
  PAYMENT_PROVIDER: z.string().default('stripe'),
  PAYMENT_API_KEY: z.string().optional().default(''),
  PAYMENT_WEBHOOK_SECRET: z.string().optional().default(''),

  SHIPPING_PROVIDER: z.string().default('shipstation'),
  SHIPPING_API_KEY: z.string().optional().default(''),

  EMAIL_PROVIDER: z.string().default('console'),
  EMAIL_API_KEY: z.string().optional().default(''),

  // Observability (T022)
  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

// Cache the parsed result so repeated calls are cheap and consistent.
let cached: Env | undefined;

/**
 * Parse and validate `process.env` once. Throws a readable error listing every
 * invalid/missing variable if validation fails.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  loadDotenvFromRoot();
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = Object.freeze(result.data);
  return cached;
}
