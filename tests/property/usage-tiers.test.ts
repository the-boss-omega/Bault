import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { TIER_KEYS, TIER_RULES, tierFor, type TierKey } from '../../apps/api/src/modules/mem/tiers';
import { closeDb, sql } from '../integration/helpers/db';

afterAll(async () => {
  await closeDb();
});

const DAY_MS = 86_400_000;

interface Charge {
  daysAgo: number;
  minutesEarlier: number;
  amount: number;
  refunded: boolean;
}

async function freshUser(): Promise<string> {
  const tag = randomBytes(5).toString('hex');
  const [row] = await sql<{ id: string }>(
    `INSERT INTO user_account (email, username, password_hash, status, role, first_name, last_name)
     VALUES ($1, $2, 'not-a-hash', 'active', 'user', 'Property', 'Tier')
     RETURNING id`,
    [`tier-${tag}@fixture.bault.test`, `pt${tag}`],
  );
  return row!.id;
}

async function charge(userId: string, c: Charge): Promise<void> {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, created_at)
     VALUES ($1, 'intake', '{}'::jsonb, $2, 'USD', 'wallet', 'settled',
             now() - make_interval(days => $3::int, mins => $4::int))
     RETURNING id`,
    [userId, c.amount, c.daysAgo, c.minutesEarlier],
  );
  if (c.refunded) await sql(`UPDATE charge SET status = 'refunded', updated_at = now() WHERE id = $1`, [row!.id]);
}

async function counts(userId: string): Promise<{ actions: number; spent: number }> {
  const [row] = await sql<{ actions: number; spent: string }>(
    `SELECT actions, spent_minor::text AS spent FROM usage_tier_counts($1::uuid)`,
    [userId],
  );
  return { actions: row!.actions, spent: Number(row!.spent) };
}

async function recompute(userId: string): Promise<TierKey> {
  const [row] = await sql<{ tier: TierKey }>(`SELECT recompute_usage_tier($1::uuid, 'nightly')::text AS tier`, [userId]);
  return row!.tier;
}

async function storedTier(userId: string): Promise<TierKey> {
  const [row] = await sql<{ usage_tier: TierKey }>(`SELECT usage_tier::text AS usage_tier FROM user_account WHERE id = $1`, [userId]);
  return row!.usage_tier;
}

const rank = (tier: TierKey) => TIER_KEYS.indexOf(tier);

const inWindow = fc.record({
  daysAgo: fc.integer({ min: 0, max: 89 }),
  minutesEarlier: fc.integer({ min: 0, max: 24 * 60 - 1 }),
  amount: fc.integer({ min: 1, max: 60_000 }),
  refunded: fc.boolean(),
});

const outOfWindow = fc.record({
  daysAgo: fc.integer({ min: 91, max: 400 }),
  minutesEarlier: fc.integer({ min: 0, max: 24 * 60 - 1 }),
  amount: fc.integer({ min: 1, max: 300_000 }),
  refunded: fc.boolean(),
});

const RUNS = { numRuns: 60 };

describe('property: the usage tier the database works out', () => {
  it('counts exactly the settled charges of the last 90 days, and names the tier their counts reach', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(inWindow, { maxLength: 35 }), fc.array(outOfWindow, { maxLength: 8 }), async (recent, old) => {
        const user = await freshUser();
        for (const c of [...recent, ...old]) await charge(user, c);
        const counted = recent.filter((c) => !c.refunded);
        const expected = { actions: counted.length, spent: counted.reduce((sum, c) => sum + c.amount, 0) };

        expect(await counts(user)).toEqual(expected);
        const tier = tierFor({ actions: expected.actions, spentMinor: expected.spent });
        expect(await storedTier(user)).toBe(tier);
        expect(await recompute(user)).toBe(tier);
        expect(await storedTier(user)).toBe(tier);
      }),
      RUNS,
    );
  });

  it('never lowers the tier when one more settled charge lands in the window', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(inWindow, { maxLength: 35 }), inWindow, async (history, extra) => {
        const user = await freshUser();
        for (const c of history) await charge(user, c);
        const before = await recompute(user);
        const usageBefore = await counts(user);
        await charge(user, { ...extra, refunded: false });
        const after = await recompute(user);
        const usageAfter = await counts(user);

        expect(usageAfter.actions).toBe(usageBefore.actions + 1);
        expect(usageAfter.spent).toBe(usageBefore.spent + extra.amount);
        expect(rank(after)).toBeGreaterThanOrEqual(rank(before));
      }),
      RUNS,
    );
  });

  it('moves at the thresholds exactly: one charge or one cent short stays below, the threshold itself reaches it', async () => {
    const thresholds = TIER_RULES.filter((r) => r.minActions > 0);
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...thresholds),
        fc.constantFrom(-1, 0),
        fc.constantFrom('actions' as const, 'dollars' as const),
        async (rule, offset, by) => {
          const user = await freshUser();
          if (by === 'actions') {
            for (let i = 0; i < rule.minActions + offset; i += 1) {
              await charge(user, { daysAgo: i % 80, minutesEarlier: 0, amount: 1, refunded: false });
            }
          } else {
            await charge(user, { daysAgo: 3, minutesEarlier: 0, amount: rule.minSpentMinor + offset, refunded: false });
          }
          const tier = await recompute(user);
          const reached = rank(tier) >= rank(rule.key);
          expect(reached).toBe(offset === 0);
        },
      ),
      { numRuns: 16 },
    );
  });

  it('never counts a charge from day 91 on or a refunded one, however large', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(inWindow.map((c) => ({ ...c, refunded: false })), { maxLength: 12 }),
        fc.array(fc.oneof(outOfWindow, inWindow.map((c) => ({ ...c, refunded: true }))), { minLength: 1, maxLength: 10 }),
        async (kept, ignored) => {
          const user = await freshUser();
          for (const c of kept) await charge(user, c);
          const before = await counts(user);
          const tierBefore = await recompute(user);
          for (const c of ignored) {
            await charge(user, c.daysAgo >= 91 ? { ...c, refunded: false } : c);
          }
          expect(await counts(user)).toEqual(before);
          expect(await recompute(user)).toBe(tierBefore);
        },
      ),
      RUNS,
    );
  });

  it('starts the window at midnight UTC 90 days back: a charge at that instant counts, one a millisecond older does not', async () => {
    const user = await freshUser();
    const [edge] = await sql<{ at: Date }>(
      `SELECT (((now() AT TIME ZONE 'UTC')::date - 90)::timestamp AT TIME ZONE 'UTC') AS at`,
    );
    const at = edge!.at;
    const insertAt = (when: Date, amount: number) =>
      sql(
        `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, created_at)
         VALUES ($1, 'intake', '{}'::jsonb, $2, 'USD', 'wallet', 'settled', $3)`,
        [user, amount, when],
      );
    await insertAt(at, 700);
    await insertAt(new Date(at.getTime() - 1), 900_000);
    await insertAt(new Date(at.getTime() - DAY_MS), 900_000);
    expect(await counts(user)).toEqual({ actions: 1, spent: 700 });
    expect(await recompute(user)).toBe('bronze');
  });
});
