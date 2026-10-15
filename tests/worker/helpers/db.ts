import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { loadEnv } from '@bault/config';

/**
 * Direct database access for the worker suite.
 *
 * The worker never goes through the API — it reads and writes the tables
 * itself — so the only honest way to test a job is the way it runs: set rows up,
 * call the job function against the same database, and count what it wrote.
 * Fixtures are made here with plain SQL for the same reason the jobs are plain
 * SQL: no service in between that could hide what the job actually did.
 *
 * Every fixture account lives at `fixture.bault.test` (see the integration
 * helpers), so none of them ever shows up next to a real customer.
 */
export function testPool(): Pool {
  const pool = new Pool({ connectionString: loadEnv().DIRECT_DATABASE_URL, max: 12 });
  // A test that terminates backends on purpose must not take the runner down.
  pool.on('error', () => undefined);
  return pool;
}

const tag = () => randomBytes(5).toString('hex');

export async function createUser(
  pool: Pool,
  status: 'pending' | 'active' | 'suspended' | 'closed' = 'active',
): Promise<string> {
  const t = tag();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO user_account (email, username, password_hash, status, role, first_name, last_name)
     VALUES ($1, $2, 'not-a-hash', $3, 'user', 'Worker', 'Fixture')
     RETURNING id`,
    [`worker-${t}@fixture.bault.test`, `wk${t}`, status],
  );
  return rows[0]!.id;
}

/** A ledger row, dated when the test says. The ledger is append-only, so INSERT is the only verb. */
export async function ledger(
  pool: Pool,
  userId: string,
  direction: 'debit' | 'credit',
  amount: number,
  daysAgo = 0,
): Promise<void> {
  await pool.query(
    `INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type, occurred_at)
     VALUES ($1, $2, $3, $4, 'USD', 'test', now() - make_interval(days => $5::int))`,
    [userId, direction === 'debit' ? 'service_charge' : 'credit_topup', amount, direction, daysAgo],
  );
}

/** A stored item that arrived `receivedDaysAgo` days ago. */
export async function createItem(pool: Pool, ownerId: string, receivedDaysAgo: number): Promise<string> {
  const t = tag();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO item (owner_id, serial_number, barcode, type_class, lifecycle_state, received_at)
     VALUES ($1, $2, $3, 'card', 'stored', now() - make_interval(days => $4::int))
     RETURNING id`,
    [ownerId, `SN-WK-${t}`, `BC-WK-${t}`, receivedDaysAgo],
  );
  return rows[0]!.id;
}

/**
 * A membership, with its cycle where the test puts it. `endsInMinutes` may be
 * negative: a cycle that has already run out and is waiting for the renewal job.
 */
export async function createMembership(
  pool: Pool,
  userId: string,
  opts: { tier?: string; status?: 'active' | 'cancelling' | 'ended'; endsInMinutes: number },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO membership (user_id, tier, status, current_period_start, current_period_end)
     VALUES ($1, $2, $3,
             now() + make_interval(mins => $4::int) - interval '30 days',
             now() + make_interval(mins => $4::int))
     RETURNING id`,
    [userId, opts.tier ?? 'folio', opts.status ?? 'active', opts.endsInMinutes],
  );
  return rows[0]!.id;
}

export async function count(pool: Pool, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${sql}) q`, params);
  return Number(rows[0]!.n);
}

/** Storage periods billed against one item. */
export const storageCharges = (pool: Pool, itemId: string) =>
  count(
    pool,
    `SELECT 1 FROM charge WHERE action_type IN ('storage', 'storage_oversized') AND reference_id = $1`,
    [itemId],
  );

/**
 * Open `n` connections at once and hand them back, so a test that races two
 * jobs is racing them on live connections — not timing how long it takes the
 * pool to dial the second one, which on a fast machine is long enough for the
 * first job to finish and hide the race completely.
 */
export async function warm(pool: Pool, n = 6): Promise<void> {
  const clients = await Promise.all(Array.from({ length: n }, () => pool.connect()));
  for (const c of clients) c.release();
}
