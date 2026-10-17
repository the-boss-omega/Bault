import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * A direct line to the test database, for the few facts HTTP cannot show.
 *
 * Every suite here drives the API over HTTP and that stays the rule. But some
 * security properties are, by design, invisible from outside: a verification
 * token exists in clear only inside the email that carried it, a password-reset
 * mail leaves through the outbox rather than inside the request, and an
 * upload's age is a timestamp nobody can wind back over HTTP.
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
interface PgClient {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
  release(): void;
}
interface PgPool {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
  connect(): Promise<PgClient>;
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
  pool ??= new Pool({ connectionString: databaseUrl(), max: 4 });
  const res = await pool.query<R>(text, values);
  return res.rows;
}

/**
 * Hold one row `FOR UPDATE` in a transaction of its own until `release`.
 *
 * For the races whose losing order is too narrow to hit by firing requests
 * together: hold the row, send the competing requests, wait until they are all
 * queued behind the lock (`waitForLockWaiters`), then let go, and they meet the
 * row in the order they queued. `table` is a fixed name from the test, never
 * input.
 */
export async function holdRowLock(table: string, id: string): Promise<{ release: () => Promise<void> }> {
  pool ??= new Pool({ connectionString: databaseUrl(), max: 4 });
  const client = await pool.connect();
  await client.query('begin');
  await client.query(`select 1 from ${table} where id = $1 for update`, [id]);
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query('rollback');
      } finally {
        client.release();
      }
    },
  };
}

/**
 * A transaction of the test's own, standing in for another session that holds
 * locks while the API works: `query` runs inside it, `rollback` ends it.
 */
export async function openTransaction(): Promise<{
  query: <R = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<R[]>;
  rollback: () => Promise<void>;
}> {
  pool ??= new Pool({ connectionString: databaseUrl(), max: 4 });
  const client = await pool.connect();
  await client.query('begin');
  let ended = false;
  return {
    query: async <R = Record<string, unknown>>(text: string, values: unknown[] = []) =>
      (await client.query<R>(text, values)).rows,
    rollback: async () => {
      if (ended) return;
      ended = true;
      try {
        await client.query('rollback');
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Wait until at least `count` other sessions on this database are waiting for a
 * lock: the requests a test sent are then queued, in the order they arrived.
 */
export async function waitForLockWaiters(count: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await sql<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
    );
    if ((row?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`expected ${count} sessions waiting on a lock, saw ${row?.n ?? 0}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Close the pool, so the test file can exit. Call from `afterAll`. */
export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  if (p) await p.end();
}
