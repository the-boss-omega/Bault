import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { SEED, signIn, type Client } from '../../tests/integration/helpers/http';
import { activeAccount, passwordOnly, type Account } from '../../tests/integration/helpers/mfa';
import { closeDb, inTransaction, sql } from '../../tests/integration/helpers/db';
import { loadEnv } from '../../packages/config/src/env';
import { recomputeUsageTiers } from '../../apps/worker/src/jobs/usage-tier-recompute';

const workerRequire = createRequire(new URL('../../apps/worker/package.json', import.meta.url));

interface Standing {
  tier: 'bronze' | 'silver' | 'gold';
  discountBps: number;
  window: { days: number; actions: number; spentMinor: number };
  next: { tier: string; actionsToGo: number; spentToGoMinor: number } | null;
}

async function account(label: string): Promise<{ who: Account; client: Client }> {
  const who = await activeAccount(label);
  return { who, client: await passwordOnly(who) };
}

async function charge(userId: string, amountMinor: number, daysAgo = 0): Promise<string> {
  return inTransaction(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, created_at)
       VALUES ($1, 'intake', '{"test":"usage-tier"}'::jsonb, $2, 'USD', 'wallet', 'settled', now() - make_interval(days => $3::int))
       RETURNING id`,
      [userId, amountMinor, daysAgo],
    );
    await c.query(
      `INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type, reference_id)
       VALUES ($1, 'service_charge', $2, 'debit', 'USD', 'charge', $3)`,
      [userId, amountMinor, rows[0]!.id],
    );
    return rows[0]!.id;
  });
}

async function charges(userId: string, n: number, amountMinor = 100): Promise<void> {
  for (let i = 0; i < n; i += 1) await charge(userId, amountMinor);
}

async function standing(client: Client): Promise<Standing> {
  const res = await client.get('/tiers/me');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Standing;
}

async function tierOf(userId: string): Promise<string> {
  const [row] = await sql<{ usage_tier: string }>(`SELECT usage_tier FROM user_account WHERE id = $1`, [userId]);
  return row!.usage_tier;
}

async function nightly(): Promise<void> {
  const { Pool } = workerRequire('pg') as {
    Pool: new (o: { connectionString: string; max: number }) => Parameters<typeof recomputeUsageTiers>[0];
  };
  const pool = new Pool({ connectionString: loadEnv().DATABASE_URL, max: 2 });
  try {
    await recomputeUsageTiers(pool);
  } finally {
    await pool.end();
  }
}

async function intakeFor(username: string) {
  const operator = await signIn(SEED.operator);
  const bins = (await operator.get('/custody/bins')).body as { id: string }[];
  const res = await operator.post('/intake/items', {
    ownerUsername: username,
    typeClass: 'trading_card',
    binId: bins[0]!.id,
    description: 'Priced at a tier',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const [row] = await sql<{ id: string; amount: string; snapshot: Record<string, unknown> }>(
    `SELECT id, amount::text, pricing_rule_snapshot AS snapshot FROM charge
      WHERE action_type = 'intake' AND reference_id = $1`,
    [(res.body as { id: string }).id],
  );
  return { itemId: (res.body as { id: string }).id, ...row! };
}

async function intakeListMinor(): Promise<number> {
  const [rule] = await sql<{ value: string }>(
    `SELECT value::text FROM pricing_rule
      WHERE action_type = 'intake' AND (item_class = 'trading_card' OR item_class IS NULL)
        AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
      ORDER BY item_class NULLS LAST, effective_from DESC LIMIT 1`,
  );
  return Number(rule!.value);
}

afterAll(async () => {
  await closeDb();
});

describe('the tier an account has from its last 90 days of use', () => {
  it('is Bronze for an account with no charges', async () => {
    const { who, client } = await account('tierbz');
    const s = await standing(client);
    expect(s.tier).toBe('bronze');
    expect(s.discountBps).toBe(0);
    expect(s.window).toEqual({ days: 90, actions: 0, spentMinor: 0 });
    expect(s.next).toMatchObject({ tier: 'silver', actionsToGo: 10, spentToGoMinor: 50_000 });
    expect(await tierOf(who.id)).toBe('bronze');
  });

  it('becomes Silver on the spot at the tenth action', async () => {
    const { who, client } = await account('tier10');
    await charges(who.id, 9);
    expect((await standing(client)).tier).toBe('bronze');
    await charge(who.id, 100);
    const s = await standing(client);
    expect(s.tier).toBe('silver');
    expect(s.window).toMatchObject({ actions: 10, spentMinor: 1_000 });
  });

  it('becomes Silver on the spot at $500.00 spent', async () => {
    const { who, client } = await account('tier500');
    await charge(who.id, 49_999);
    expect((await standing(client)).tier).toBe('bronze');
    await charge(who.id, 1);
    expect((await standing(client)).tier).toBe('silver');
  });

  it('becomes Gold at the thirtieth action, and at $2,000.00 spent', async () => {
    const byCount = await account('tier30');
    await charges(byCount.who.id, 29);
    expect((await standing(byCount.client)).tier).toBe('silver');
    await charge(byCount.who.id, 100);
    const gold = await standing(byCount.client);
    expect(gold.tier).toBe('gold');
    expect(gold.discountBps).toBe(2_000);
    expect(gold.next).toBeNull();

    const bySpend = await account('tier2k');
    await charge(bySpend.who.id, 199_999);
    expect((await standing(bySpend.client)).tier).toBe('silver');
    await charge(bySpend.who.id, 1);
    expect((await standing(bySpend.client)).tier).toBe('gold');
  });

  it('stops counting a charge 91 days old at the nightly recompute, and still counts one 90 days old', async () => {
    const aged = await account('tier91');
    const kept = await account('tier90');
    await charges(aged.who.id, 10);
    await charges(kept.who.id, 10);
    expect(await tierOf(aged.who.id)).toBe('silver');
    expect(await tierOf(kept.who.id)).toBe('silver');

    const oldest = `UPDATE charge SET created_at = now() - $2::interval
                     WHERE id = (SELECT id FROM charge WHERE user_id = $1 ORDER BY created_at LIMIT 1)`;
    await sql(oldest, [aged.who.id, '91 days']);
    await sql(oldest, [kept.who.id, '90 days']);
    expect(await tierOf(aged.who.id)).toBe('silver');

    await nightly();

    expect(await tierOf(aged.who.id)).toBe('bronze');
    expect(await tierOf(kept.who.id)).toBe('silver');
    const [change] = await sql<Record<string, unknown>>(
      `SELECT from_tier, to_tier, actions, spent_minor::int AS spent_minor, trigger FROM usage_tier_change
        WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [aged.who.id],
    );
    expect(change).toEqual({ from_tier: 'silver', to_tier: 'bronze', actions: 9, spent_minor: 900, trigger: 'nightly' });
  });
});

describe('the discount a tier gives', () => {
  it('prices a Gold account 20 percent under the list price, and records the four fields in the snapshot', async () => {
    const { who } = await account('tiergd');
    await charges(who.id, 30);
    expect(await tierOf(who.id)).toBe('gold');

    const list = await intakeListMinor();
    const charged = await intakeFor(who.username);
    const expected = list - Math.round((list * 2_000) / 10_000);
    expect(expected).toBe(list * 0.8);
    expect(Number(charged.amount)).toBe(expected);
    expect(charged.snapshot).toMatchObject({ tier: 'gold', discountBps: 2_000, listMinor: list, chargedMinor: expected });
  });

  it('leaves yesterday’s charge as it was when the account falls back a tier', async () => {
    const { who } = await account('tierdn');
    await charges(who.id, 30);
    const yesterday = await intakeFor(who.username);
    await sql(`UPDATE charge SET created_at = now() - interval '1 day' WHERE id = $1`, [yesterday.id]);
    await sql(`UPDATE charge SET created_at = now() - interval '120 days' WHERE user_id = $1 AND id <> $2`, [
      who.id,
      yesterday.id,
    ]);

    await nightly();
    expect(await tierOf(who.id)).toBe('bronze');

    const [after] = await sql<{ amount: string; snapshot: Record<string, unknown> }>(
      `SELECT amount::text, pricing_rule_snapshot AS snapshot FROM charge WHERE id = $1`,
      [yesterday.id],
    );
    expect(after!.amount).toBe(yesterday.amount);
    expect(after!.snapshot).toEqual(yesterday.snapshot);
    expect(after!.snapshot).toMatchObject({ tier: 'gold', discountBps: 2_000 });

    const list = await intakeListMinor();
    const today = await intakeFor(who.username);
    expect(Number(today.amount)).toBe(list);
    expect(today.snapshot).toMatchObject({ tier: 'bronze', discountBps: 0, listMinor: list, chargedMinor: list });
  });

  it('takes a refunded charge out of the count, on the spot', async () => {
    const { who, client } = await account('tierrf');
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    const cashIn = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 50_000,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `tier-refund-${Date.now()}`,
    });
    expect(cashIn.status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${cashIn.body.id}/approve`, {})).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${cashIn.body.id}/complete`, {})).status).toBe(201);

    const { itemId } = await intakeFor(who.username);
    await charges(who.id, 9 - (await standing(client)).window.actions);
    expect((await standing(client)).window.actions).toBe(9);
    expect((await standing(client)).tier).toBe('bronze');

    const req = await client.post('/services/grading', { itemId, tier: 'psa_regular', declaredMinor: 50_000 });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect((await standing(client)).tier).toBe('silver');

    expect((await operator.post(`/services/requests/${req.body.id}/deny`)).status).toBe(201);
    const s = await standing(client);
    expect(s.window.actions).toBe(9);
    expect(s.tier).toBe('bronze');
    const refunded = await sql<{ status: string }>(`SELECT status FROM charge WHERE user_id = $1 AND status <> 'settled'`, [
      who.id,
    ]);
    expect(refunded.map((r) => r.status)).toEqual(['refunded']);
  });
});
