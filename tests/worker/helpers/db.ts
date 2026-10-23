import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { loadEnv } from '@bault/config';

export function testPool(): Pool {
  const pool = new Pool({ connectionString: loadEnv().DIRECT_DATABASE_URL, max: 12 });
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

export const storageCharges = (pool: Pool, itemId: string) =>
  count(
    pool,
    `SELECT 1 FROM charge WHERE action_type IN ('storage', 'storage_oversized') AND reference_id = $1`,
    [itemId],
  );

export async function warm(pool: Pool, n = 6): Promise<void> {
  const clients = await Promise.all(Array.from({ length: n }, () => pool.connect()));
  for (const c of clients) c.release();
}
