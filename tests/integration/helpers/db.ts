import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * A direct line to the test database, for the few facts HTTP cannot show.
 *
 * Every suite here drives the API over HTTP and that stays the rule. But some
 * of what the security fixes promise is, by design, invisible from outside:
 * a verification token exists in clear only inside the email that carried it,
 * a password-reset mail now leaves through the outbox rather than inside the
 * request, and an upload's age is a timestamp nobody can wind back over HTTP.
 * A test that cannot reach those has to either skip the property or trust it.
 *
 * Kept deliberately small: open a pool, run a query, close it. `pg` is resolved
 * from the API package, the same way `vitest.workspace.ts` reaches the adapters
 * and React — the root manifest stays free of a database driver it does not
 * otherwise need.
 */

interface QueryResult<R> {
  rows: R[];
  rowCount: number | null;
}
interface PgPool {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
  end(): Promise<void>;
}

const requireFromApi = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
const { Pool } = requireFromApi('pg') as { Pool: new (config: { connectionString: string; max?: number }) => PgPool };

/**
 * The same database the API under test is using: the direct URL when the
 * environment names one (CI), otherwise the worktree's `.env`, which is where
 * `pnpm --filter @bault/api db:seed` read it from too.
 */
function databaseUrl(): string {
  const fromEnv = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  let text = '';
  try {
    text = readFileSync(join(process.cwd(), '.env'), 'utf8');
  } catch {
    throw new Error('tests/integration/helpers/db: no DATABASE_URL in the environment and no .env in the working directory');
  }
  const pick = (name: string) => text.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
  const url = pick('DIRECT_DATABASE_URL') ?? pick('DATABASE_URL');
  if (!url) throw new Error('tests/integration/helpers/db: .env names no DATABASE_URL');
  return url;
}

let pool: PgPool | undefined;

/** Run one statement against the test database. */
export async function sql<R = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<R[]> {
  pool ??= new Pool({ connectionString: databaseUrl(), max: 2 });
  const res = await pool.query<R>(text, values);
  return res.rows;
}

/** Close the pool, so the test file can exit. Call from `afterAll`. */
export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  if (p) await p.end();
}
