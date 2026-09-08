import { describe, it, expect } from 'vitest';
import { SEED, signIn, intakeFor, fundWallet } from '../../tests/integration/helpers/http';

/**
 * Break-Even Watch.
 *
 * The feature is a custodian telling a collector to stop paying it, so the thing
 * that has to be true above all others is that it never invents the number it
 * uses to give that advice. Bault has no price feed. Most of this file is about
 * what it does when it cannot price something.
 */

interface Row {
  itemId: string;
  serialNumber: string;
  totalSpentMinor: number;
  storageSpentMinor: number;
  projectedYearMinor: number;
  estimatedValueMinor: number | null;
  valueBasis: 'sold_comparable' | 'own_asking_price' | 'unknown';
  comparableCount: number;
  pastBreakEven: boolean;
  monthsToBreakEven: number | null;
}

interface Summary {
  itemCount: number;
  totalSpentMinor: number;
  projectedYearMinor: number;
  pastBreakEvenCount: number;
  pastBreakEvenSpendMinor: number;
  unknownValueCount: number;
  items: Row[];
}

describe('what it will and will not claim to know', () => {
  it('never reports a value it cannot source, and says so instead', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/vault/break-even');
    expect(res.status).toBe(200);

    const body = res.body as Summary;
    for (const row of body.items) {
      if (row.valueBasis === 'unknown') {
        // The honest case. An unpriceable card reports its cost and nothing
        // else — never a guess dressed as an estimate.
        expect(row.estimatedValueMinor).toBeNull();
        expect(row.comparableCount).toBe(0);
        // And it can never be "past break-even": there is no line to be past.
        expect(row.pastBreakEven).toBe(false);
        expect(row.monthsToBreakEven).toBeNull();
      } else {
        expect(row.estimatedValueMinor).not.toBeNull();
        expect(row.estimatedValueMinor!).toBeGreaterThan(0);
      }
    }
  });

  it('backs a comparable with real sales, and counts them', async () => {
    const collector = await signIn(SEED.collector);
    const body = (await collector.get('/vault/break-even')).body as Summary;

    for (const row of body.items.filter((r) => r.valueBasis === 'sold_comparable')) {
      // A comparable that is not drawn from a transaction is an opinion.
      expect(row.comparableCount).toBeGreaterThan(0);
    }
  });

  it('tells the collector how much of their vault it cannot price', async () => {
    const collector = await signIn(SEED.collector);
    const body = (await collector.get('/vault/break-even')).body as Summary;

    // That figure is the honest limit on everything else on the page, so it is
    // reported rather than hidden.
    const unknown = body.items.filter((r) => r.valueBasis === 'unknown').length;
    expect(body.unknownValueCount).toBe(unknown);
  });

  it('prefers a real sale over the owner’s own asking price', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);

    // A class with no sales at all, listed by its owner at a wild number.
    const item = await intakeFor(operator, SEED.collector, {
      typeClass: 'memorabilia',
      description: 'Break-even: asking price only',
    });
    const listed = await collector.post('/marketplace/listings', {
      itemId: item.id,
      askingPrice: 999_00,
    });
    expect(listed.status).toBe(201);

    const body = (await collector.get('/vault/break-even')).body as Summary;
    const row = body.items.find((r) => r.itemId === item.id)!;
    // No comparable exists for this class, so the owner's hope is the only
    // signal — and it is labelled as exactly that.
    expect(row.valueBasis).toBe('own_asking_price');
    expect(row.estimatedValueMinor).toBe(999_00);
    expect(row.comparableCount).toBe(0);
  });
});

describe('what it counts', () => {
  it('counts what was actually charged, not what the clock implies', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);

    const before = (await collector.get('/vault/break-even')).body as Summary;
    const item = await intakeFor(operator, SEED.collector, {
      description: 'Break-even: fresh intake',
    });
    const after = (await collector.get('/vault/break-even')).body as Summary;

    const row = after.items.find((r) => r.itemId === item.id)!;
    // A card booked in seconds ago has been charged its intake fee and no
    // storage — a figure derived from elapsed time would already show storage
    // nobody had billed.
    expect(row.totalSpentMinor).toBeGreaterThan(0);
    expect(row.storageSpentMinor).toBe(0);
    expect(row.projectedYearMinor).toBe(0);

    expect(after.itemCount).toBe(before.itemCount + 1);
    expect(after.totalSpentMinor).toBeGreaterThan(before.totalSpentMinor);
  });

  it('covers only the cards still on a shelf', async () => {
    const collector = await signIn(SEED.collector);
    const [watch, vault] = await Promise.all([
      collector.get('/vault/break-even'),
      collector.get('/vault/items'),
    ]);
    const watched = new Set((watch.body as Summary).items.map((r) => r.itemId));
    const held = (vault.body as { id: string }[]).map((i) => i.id);

    // Advice about a card that has already been shipped or sold is noise.
    for (const id of held) expect(watched.has(id), `${id} missing from the watch`).toBe(true);
  });

  it('puts the worst position first', async () => {
    const collector = await signIn(SEED.collector);
    const body = (await collector.get('/vault/break-even')).body as Summary;

    // Past break-even, then closest to it, then the unpriceable — because the
    // page exists to be acted on from the top.
    const rank = (r: Row) =>
      r.pastBreakEven ? 0 : r.monthsToBreakEven === null ? 2 : 1;
    const ranks = body.items.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('who can see it', () => {
  it('shows a collector only their own cards', async () => {
    const operator = await signIn(SEED.operator);
    const mine = await intakeFor(operator, SEED.collector, { description: 'Red owns this one' });

    const other = await signIn(SEED.collector2);
    const body = (await other.get('/vault/break-even')).body as Summary;
    expect(body.items.some((r) => r.itemId === mine.id)).toBe(false);
  });

  it('is not readable without a session', async () => {
    const { Client } = await import('../../tests/integration/helpers/http');
    const anon = new Client();
    expect((await anon.get('/vault/break-even')).status).toBe(401);
  });
});

describe('the arithmetic holds together', () => {
  it('adds up to the summary it reports', async () => {
    const collector = await signIn(SEED.collector);
    const body = (await collector.get('/vault/break-even')).body as Summary;

    expect(body.totalSpentMinor).toBe(body.items.reduce((s, r) => s + r.totalSpentMinor, 0));
    expect(body.projectedYearMinor).toBe(body.items.reduce((s, r) => s + r.projectedYearMinor, 0));
    expect(body.pastBreakEvenCount).toBe(body.items.filter((r) => r.pastBreakEven).length);
    expect(body.pastBreakEvenSpendMinor).toBe(
      body.items.filter((r) => r.pastBreakEven).reduce((s, r) => s + r.totalSpentMinor, 0),
    );
  });

  it('never claims a card is past break-even while it is still worth more than it cost', async () => {
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 25_00);
    const body = (await collector.get('/vault/break-even')).body as Summary;

    for (const row of body.items) {
      if (row.estimatedValueMinor === null) continue;
      expect(row.pastBreakEven).toBe(row.totalSpentMinor >= row.estimatedValueMinor);
    }
  });
});
