import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { runStorageFees } from '../../apps/worker/src/jobs/storage-fee';
import { SEED, SEED_PASSWORD, signIn, type Client } from '../integration/helpers/http';
import { count, createItem, createMembership, createUser, storageCharges, testPool, warm } from './helpers/db';

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

describe('a membership that stops covering an item', () => {
  it('bills at most one period when cover ends, not every period the item was covered for (F009, F021)', async () => {
    const member = await createUser(pool);
    await createMembership(pool, member, { endsInMinutes: 60 * 24 * 10 });
    const card = await createItem(pool, member, 400);

    await runStorageFees(pool);
    expect(await storageCharges(pool, card)).toBe(0);

    await pool.query(`UPDATE membership SET status = 'ended', ended_at = now() WHERE user_id = $1`, [member]);

    await runStorageFees(pool);
    expect(await storageCharges(pool, card)).toBe(1);

    await runStorageFees(pool);
    expect(await storageCharges(pool, card)).toBe(1);
  });

  it('does not bill a member whose cycle ran out minutes before the sweep and is about to renew (F021)', async () => {
    const member = await createUser(pool);
    await createMembership(pool, member, { endsInMinutes: -5 });
    const card = await createItem(pool, member, 400);

    await runStorageFees(pool);

    expect(await storageCharges(pool, card)).toBe(0);
    const { rows } = await pool.query<{ live: boolean }>(
      `SELECT current_period_end > now() AS live FROM membership WHERE user_id = $1`,
      [member],
    );
    expect(rows[0]!.live).toBe(true);
  });
});

describe('running the sweep more than once', () => {
  it('bills the same periods run once, run twice, or run twice at the same moment (F070)', async () => {
    const owner = await createUser(pool);
    const once = await createItem(pool, owner, 400);
    await runStorageFees(pool);
    expect(await storageCharges(pool, once)).toBe(3);
    await runStorageFees(pool);
    expect(await storageCharges(pool, once)).toBe(3);

    const items: string[] = [];
    for (let i = 0; i < 20; i += 1) items.push(await createItem(pool, owner, 400));
    await warm(pool);
    await Promise.all([runStorageFees(pool), runStorageFees(pool)]);
    expect(
      await count(
        pool,
        `SELECT 1 FROM charge WHERE action_type = 'storage' AND reference_id = ANY($1::text[])`,
        [items],
      ),
    ).toBe(20 * 3);
  });
});

async function splitLot(
  pool: Pool,
  ownerId: string,
  opts: { lotReceivedDaysAgo: number; splitDaysAgo: number; cards: number },
): Promise<{ lot: string; cards: string[] }> {
  const t = () => Math.random().toString(16).slice(2, 12);
  const lot = (
    await pool.query<{ id: string }>(
      `INSERT INTO item (owner_id, serial_number, barcode, type_class, lifecycle_state, received_at,
                         is_lot, lot_size, lot_broken)
       VALUES ($1, $2, $2, 'card', 'stored', now() - make_interval(days => $3::int), true, $4, true)
       RETURNING id`,
      [ownerId, `LOT-WK-${t()}`, opts.lotReceivedDaysAgo, opts.cards],
    )
  ).rows[0]!.id;
  const cards: string[] = [];
  for (let i = 0; i < opts.cards; i += 1) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO item (owner_id, serial_number, barcode, type_class, lifecycle_state, received_at)
       VALUES ($1, $2, $2, 'card', 'stored', now() - make_interval(days => $3::int))
       RETURNING id`,
      [ownerId, `SN-WK-${t()}`, opts.splitDaysAgo],
    );
    cards.push(rows[0]!.id);
  }
  return { lot, cards };
}

describe('a lot that has been split into its cards (F006)', () => {
  it('bills the cards, and never the lot they came out of', async () => {
    const owner = await createUser(pool);
    const { lot, cards } = await splitLot(pool, owner, { lotReceivedDaysAgo: 400, splitDaysAgo: 250, cards: 3 });

    await runStorageFees(pool);
    await runStorageFees(pool);

    expect(await storageCharges(pool, lot)).toBe(0);
    for (const card of cards) expect(await storageCharges(pool, card)).toBe(1);
  });

  it('does not let the split lot take one of a member’s covered slots', async () => {
    const member = await createUser(pool);
    await createMembership(pool, member, { endsInMinutes: 60 * 24 * 10 });
    const { rows } = await pool.query<{ slots: number }>(
      `SELECT (parameters ->> 'storedItems')::int AS slots
         FROM pricing_rule
        WHERE action_type = 'membership:folio' AND effective_from <= now()
          AND (effective_to IS NULL OR effective_to > now())
        ORDER BY effective_from DESC LIMIT 1`,
    );
    const slots = rows[0]!.slots;
    const { lot, cards } = await splitLot(pool, member, { lotReceivedDaysAgo: 400, splitDaysAgo: 250, cards: slots });

    await runStorageFees(pool);

    expect(
      await count(
        pool,
        `SELECT 1 FROM charge WHERE action_type IN ('storage', 'storage_oversized') AND reference_id = ANY($1::text[])`,
        [[lot, ...cards]],
      ),
    ).toBe(0);
    expect(await count(pool, `SELECT 1 FROM storage_cover WHERE item_id = $1`, [lot])).toBe(0);
    expect(await count(pool, `SELECT 1 FROM storage_cover WHERE item_id = ANY($1::uuid[])`, [cards])).toBe(slots);
  });
});

describe('the next storage charge the vault names', () => {
  const DAY_MS = 86_400_000;

  async function collectorWithLogin(): Promise<{ id: string; client: Client }> {
    const id = await createUser(pool);
    const { rows } = await pool.query<{ email: string }>(
      `UPDATE user_account u
          SET password_hash = s.password_hash, terms_version = s.terms_version, terms_accepted_at = s.terms_accepted_at
         FROM user_account s
        WHERE u.id = $1 AND s.email = $2
       RETURNING u.email`,
      [id, SEED.collector],
    );
    return { id, client: await signIn(rows[0]!.email, SEED_PASSWORD) };
  }

  it('dates it from the end of membership cover, and prices it as the sweep does (never under a cent)', async () => {
    const { id: owner, client } = await collectorWithLogin();
    const card = await createItem(pool, owner, 400);
    await pool.query(
      `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, reference_id)
       VALUES ($1, 'intake', '{}'::jsonb, 4, 'USD', 'wallet', 'settled', $2)`,
      [owner, card],
    );
    await pool.query(`INSERT INTO storage_cover (item_id, covered_until) VALUES ($1, now() - interval '10 days')`, [
      card,
    ]);

    await runStorageFees(pool);
    const billed = await pool.query<{ amount: number }>(
      `SELECT amount::int AS amount FROM charge WHERE action_type = 'storage' AND reference_id = $1`,
      [card],
    );
    expect(billed.rows).toHaveLength(1);
    const { rows } = await pool.query<{ covered_until: Date }>(
      `SELECT covered_until FROM storage_cover WHERE item_id = $1`,
      [card],
    );

    const res = await client.get(`/vault/items/${card}/storage`);
    expect(res.status).toBe(200);
    expect(new Date(res.body.nextChargeAt).getTime()).toBe(
      rows[0]!.covered_until.getTime() + res.body.periodDays * DAY_MS,
    );
    expect(new Date(res.body.nextChargeAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body.periodChargeMinor).toBe(billed.rows[0]!.amount);
  });

  it('names none while a membership covers the card, because the sweep bills none', async () => {
    const { id: owner, client } = await collectorWithLogin();
    await createMembership(pool, owner, { endsInMinutes: 60 * 24 * 10 });
    const card = await createItem(pool, owner, 400);

    await runStorageFees(pool);
    expect(await storageCharges(pool, card)).toBe(0);

    const res = await client.get(`/vault/items/${card}/storage`);
    expect(res.status).toBe(200);
    expect(res.body.nextChargeAt).toBeNull();
    expect(res.body.coveredByMembership).toBe(true);
  });
});
