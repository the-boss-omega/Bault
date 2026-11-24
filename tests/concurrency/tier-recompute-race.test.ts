import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tierFor } from '../../apps/api/src/modules/mem/tiers';
import { closeDb, sql, waitForLockWaiters } from '../integration/helpers/db';

interface PgClient {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  release(): void;
}
interface PgPool {
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}
const requireFromApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = requireFromApi('pg') as { Pool: new (config: { connectionString: string; max?: number }) => PgPool };

let pool: PgPool;

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!, max: 4 });
});

afterAll(async () => {
  await pool.end();
  await closeDb();
});

async function freshUser(): Promise<string> {
  const tag = randomBytes(5).toString('hex');
  const [row] = await sql<{ id: string }>(
    `INSERT INTO user_account (email, username, password_hash, status, role, first_name, last_name)
     VALUES ($1, $2, 'not-a-hash', 'active', 'user', 'Race', 'Tier') RETURNING id`,
    [`race-${tag}@fixture.bault.test`, `rt${tag}`],
  );
  return row!.id;
}

const CHARGE = `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status)
                VALUES ($1, 'intake', '{}'::jsonb, 100, 'USD', 'wallet', 'settled')`;

async function settledCharges(user: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) await sql(CHARGE, [user]);
}

async function settleWhileNightlyRuns(user: string): Promise<void> {
  const settling = await pool.connect();
  const nightly = await pool.connect();
  try {
    await settling.query('BEGIN');
    await settling.query(CHARGE, [user]);
    const recompute = nightly.query(`SELECT recompute_usage_tier($1::uuid, 'nightly')`, [user]);
    await Promise.race([waitForLockWaiters(1, 2_000).catch(() => undefined), recompute]);
    await settling.query('COMMIT');
    await recompute;
  } finally {
    settling.release();
    nightly.release();
  }
}

async function outcome(user: string) {
  const [account] = await sql<{ usage_tier: string }>(`SELECT usage_tier::text AS usage_tier FROM user_account WHERE id = $1`, [user]);
  const [usage] = await sql<{ actions: number; spent: string }>(
    `SELECT actions, spent_minor::text AS spent FROM usage_tier_counts($1::uuid)`,
    [user],
  );
  const history = await sql<{ from_tier: string; to_tier: string; reason: string }>(
    `SELECT from_tier::text AS from_tier, to_tier::text AS to_tier, reason FROM usage_tier_change WHERE user_id = $1 ORDER BY created_at, id`,
    [user],
  );
  return {
    tier: account!.usage_tier,
    deserved: tierFor({ actions: usage!.actions, spentMinor: Number(usage!.spent) }),
    history,
  };
}

describe('concurrency: a charge settling while the nightly tier recompute runs', () => {
  it('the charge that reaches Silver and the nightly pass leave one tier, the right one, and one history row', async () => {
    const user = await freshUser();
    await settledCharges(user, 9);
    expect((await outcome(user)).tier).toBe('bronze');

    await settleWhileNightlyRuns(user);

    const after = await outcome(user);
    expect(after.tier).toBe('silver');
    expect(after.tier).toBe(after.deserved);
    expect(after.history).toEqual([{ from_tier: 'bronze', to_tier: 'silver', reason: 'charge' }]);
  });

  it('a charge that keeps Silver, settling as the nightly pass would drop an aged-out charge, does not lose the tier', async () => {
    const user = await freshUser();
    await settledCharges(user, 10);
    await sql(
      `UPDATE charge SET created_at = now() - interval '95 days'
        WHERE id = (SELECT id FROM charge WHERE user_id = $1 ORDER BY created_at LIMIT 1)`,
      [user],
    );
    expect((await outcome(user)).tier).toBe('silver');

    await settleWhileNightlyRuns(user);

    const after = await outcome(user);
    expect(after.deserved).toBe('silver');
    expect(after.tier).toBe(after.deserved);
    expect(after.history).toEqual([{ from_tier: 'bronze', to_tier: 'silver', reason: 'charge' }]);
  });

  it('many charges settling at once against many nightly passes end on the tier the charges deserve', async () => {
    const user = await freshUser();
    await settledCharges(user, 7);
    await Promise.all([
      ...Array.from({ length: 6 }, () => sql(CHARGE, [user])),
      ...Array.from({ length: 6 }, () => sql(`SELECT recompute_usage_tier($1::uuid, 'nightly')`, [user])),
    ]);
    const after = await outcome(user);
    expect(after.deserved).toBe('silver');
    expect(after.tier).toBe('silver');
    expect(after.history).toHaveLength(1);
  });
});
