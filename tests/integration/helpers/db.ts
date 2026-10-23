import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

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

export async function sql<R = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<R[]> {
  pool ??= new Pool({ connectionString: databaseUrl(), max: 4 });
  const res = await pool.query<R>(text, values);
  return res.rows;
}

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

export async function closeDb(): Promise<void> {
  const p = pool;
  pool = undefined;
  if (p) await p.end();
}
