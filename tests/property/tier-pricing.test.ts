import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDb, type Database } from '../../apps/api/src/db/client';
import { PricingService } from '../../apps/api/src/modules/prc/pricing.service';
import { TIER_KEYS, tierRule, type TierKey } from '../../apps/api/src/modules/mem/tiers';
import { money } from '../../apps/api/src/shared/money';
import { SEED, SEED_PASSWORD, binIds, fundWallet, signIn, usernameOf, type Client } from '../integration/helpers/http';
import { closeDb, sql } from '../integration/helpers/db';

let db: Database;
let close: () => Promise<void>;
const opened: string[] = [];

beforeAll(() => {
  const made = createDb();
  db = made.db;
  close = () => made.pool.end();
});

afterAll(async () => {
  if (opened.length > 0) {
    await sql(`UPDATE pricing_rule SET effective_to = now() WHERE id = ANY($1::uuid[]) AND effective_to IS NULL`, [opened]);
  }
  await close();
  await closeDb();
});

function reference(listMinor: number, discountBps: number): number {
  if (listMinor <= 0 || discountBps <= 0) return listMinor;
  const off = (BigInt(listMinor) * BigInt(discountBps) + 5_000n) / 10_000n;
  return Number(BigInt(listMinor) - off);
}

function reconciles(snapshot: Record<string, unknown>, tier: TierKey, chargedMinor: number) {
  const bps = tierRule(tier).discountBps;
  expect(snapshot.tier).toBe(tier);
  expect(snapshot.discountBps).toBe(bps);
  expect(snapshot.chargedMinor).toBe(chargedMinor);
  const list = snapshot.listMinor as number;
  expect(chargedMinor).toBe(reference(list, bps));
  expect(chargedMinor).toBeGreaterThanOrEqual(0);
  expect(chargedMinor).toBeLessThanOrEqual(list);
}

const tier = fc.constantFrom(...TIER_KEYS);

async function userAt(t: TierKey): Promise<string> {
  const tag = randomBytes(5).toString('hex');
  const [row] = await sql<{ id: string }>(
    `INSERT INTO user_account (email, username, password_hash, status, role, first_name, last_name, usage_tier)
     VALUES ($1, $2, 'not-a-hash', 'active', 'user', 'Property', 'Price', $3)
     RETURNING id`,
    [`price-${tag}@fixture.bault.test`, `pp${tag}`, t],
  );
  return row!.id;
}

async function ruleFor(model: 'fixed' | 'percentage', value: number): Promise<string> {
  const actionType = `property_price:${randomBytes(5).toString('hex')}`;
  const [row] = await sql<{ id: string }>(
    `INSERT INTO pricing_rule (action_type, model, value, currency, effective_from, description)
     VALUES ($1, $2, $3, 'USD', now() - interval '1 second', 'Property test rule') RETURNING id`,
    [actionType, model, value],
  );
  opened.push(row!.id);
  return actionType;
}

describe('property: a price at a tier', () => {
  it('charges the list price less the tier’s basis points, rounded half up, never below zero, for any list price', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), tier, (list, t) => {
        const quote = PricingService.atTier(t, list);
        expect(quote).toEqual({ tier: t, discountBps: tierRule(t).discountBps, listMinor: list, chargedMinor: reference(list, tierRule(t).discountBps) });
        reconciles({ ...quote }, t, quote.chargedMinor);
      }),
      { numRuns: 2_000 },
    );
  });

  it('prices a fixed rule for an account at its stored tier, and the snapshot’s four fields reconcile', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5_000_000 }), tier, async (value, t) => {
        const [user, actionType] = await Promise.all([userAt(t), ruleFor('fixed', value)]);
        const priced = await new PricingService(db).price(actionType, { userId: user });
        expect(priced.snapshot.listMinor).toBe(value);
        expect(priced.snapshot.value).toBe(value);
        reconciles(priced.snapshot, t, priced.amount.amount);
      }),
      { numRuns: 40 },
    );
  });

  it('takes a percentage rule of its base first, then the tier off what that comes to', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 0, max: 50_000_000 }),
        tier,
        async (bps, base, t) => {
          const [user, actionType] = await Promise.all([userAt(t), ruleFor('percentage', bps)]);
          const priced = await new PricingService(db).price(actionType, { userId: user, base: money(base, 'USD') });
          expect(priced.snapshot.listMinor).toBe(Math.round((base * bps) / 10_000));
          reconciles(priced.snapshot, t, priced.amount.amount);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('property: what a collector is charged through the API', () => {
  let admin: Client;
  let operator: Client;
  let collector: Client;
  let collectorId: string;
  let ownerUsername: string;
  let bin: string;
  let restore: { description: string; value: number } | undefined;

  beforeAll(async () => {
    admin = await signIn(SEED.admin, SEED_PASSWORD);
    operator = await signIn(SEED.operator, SEED_PASSWORD);
    collector = await signIn(SEED.collector3, SEED_PASSWORD);
    ownerUsername = await usernameOf(SEED.collector3);
    [bin] = await binIds(operator);
    const [me] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [SEED.collector3]);
    collectorId = me!.id;
    const rules = (await admin.get('/pricing/rules')).body as { actionType: string; itemClass: string | null; value: number; description: string }[];
    restore = rules.find((r) => r.actionType === 'service_fee:video_review' && r.itemClass === null);
    await fundWallet(SEED.collector3, 500_000);
  });

  afterAll(async () => {
    await sql(`SELECT recompute_usage_tier($1::uuid, 'nightly')`, [collectorId]);
    if (restore) {
      await admin.post('/pricing/rules', {
        actionType: 'service_fee:video_review',
        description: restore.description,
        model: 'fixed',
        value: restore.value,
        billingTrigger: 'per_event',
      });
    }
  });

  it('records a charge whose amount and snapshot follow the price in force and the tier, for any price and tier', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50_000 }), tier, async (value, t) => {
        const set = await admin.post('/pricing/rules', {
          actionType: 'service_fee:video_review',
          description: `Video review at ${value}`,
          model: 'fixed',
          value,
          billingTrigger: 'per_event',
        });
        expect(set.status, JSON.stringify(set.body)).toBe(201);
        const item = await operator.post('/intake/items', { ownerUsername, typeClass: 'trading_card', binId: bin });
        expect(item.status).toBe(201);
        await sql(`UPDATE user_account SET usage_tier = $2 WHERE id = $1`, [collectorId, t]);

        const asked = await collector.post('/services/video', { itemId: item.body.id });
        expect(asked.status, JSON.stringify(asked.body)).toBe(201);
        const [row] = await sql<{ amount: string; snapshot: Record<string, unknown> }>(
          `SELECT amount::text, pricing_rule_snapshot AS snapshot FROM charge
            WHERE reference_id = $1 AND pricing_rule_snapshot ->> 'actionType' = 'service_fee:video_review'`,
          [item.body.id],
        );
        expect(row, 'one charge for the video review').toBeTruthy();
        expect(row!.snapshot.listMinor).toBe(value);
        reconciles(row!.snapshot, t, Number(row!.amount));
      }),
      { numRuns: 8 },
    );
  });
});
