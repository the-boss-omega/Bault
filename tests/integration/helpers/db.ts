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

/** Runs `work` on one connection inside BEGIN … COMMIT, rolling back if it throws: what a worker job is handed. */
export async function inTransaction<T>(work: (client: PgClient) => Promise<T>): Promise<T> {
  pool ??= new Pool({ connectionString: databaseUrl(), max: 4 });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await work(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
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

const HONOURED_STORED_ITEMS: Record<string, number> = { bronze: 60, silver: 200, gold: 750 };

/**
 * A paid membership as migration 0046 left it: a live period whose allowances are honoured until it ends.
 * Memberships are no longer sold, so a test that needs the honoured allowances writes one here.
 */
export async function honouredMembership(
  user: { id?: string; email?: string },
  tier: 'bronze' | 'silver' | 'gold',
): Promise<{ membershipId: string; periodId: string }> {
  const [row] = await sql<{ id: string }>(
    user.id ? `SELECT id FROM user_account WHERE id = $1` : `SELECT id FROM user_account WHERE email = $1`,
    [user.id ?? user.email],
  );
  if (!row) throw new Error(`honouredMembership: no account ${user.id ?? user.email}`);
  const [period] = await sql<{ membership_id: string; id: string }>(
    `WITH m AS (
       INSERT INTO membership (user_id, tier, status, current_period_start, current_period_end, honoured_until, honoured_stored_items)
       VALUES ($1, $2, 'active',
               date_trunc('milliseconds', now()) - interval '1 day',
               date_trunc('milliseconds', now()) + interval '29 days',
               date_trunc('milliseconds', now()) + interval '29 days',
               $3)
       ON CONFLICT ON CONSTRAINT membership_user_unique DO UPDATE
         SET tier = EXCLUDED.tier, status = 'active', scheduled_tier = NULL, cancelled_at = NULL, ended_at = NULL,
             current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end,
             honoured_until = EXCLUDED.honoured_until, honoured_stored_items = EXCLUDED.honoured_stored_items,
             updated_at = now()
       RETURNING id, user_id, tier, current_period_start, current_period_end
     )
     INSERT INTO membership_period (membership_id, user_id, tier, period_start, period_end, fee, currency, consumed)
     SELECT id, user_id, tier, current_period_start, current_period_end, 0, 'USD', '{}'::jsonb FROM m
     ON CONFLICT DO NOTHING
     RETURNING membership_id, id`,
    [row.id, tier, HONOURED_STORED_ITEMS[tier]],
  );
  if (!period) throw new Error('honouredMembership: no period was opened');
  return { membershipId: period.membership_id, periodId: period.id };
}
