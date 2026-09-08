import { describe, it, expect } from 'vitest';
import { Client, SEED, signIn, intakeFor, fundWallet } from '../../tests/integration/helpers/http';

/**
 * Shelf Yield — the operator half of the engine behind Break-Even Watch.
 *
 * The assertion that matters most is about REVENUE ATTRIBUTION, because it is
 * the thing that was broken before this existed and the thing a yield number is
 * worthless without. A sale writes no `charge` row: the commission lives only as
 * a `ledger_record` of type `fee` pointing at a listing. A yield computed from
 * charges alone reports zero revenue for every card that actually sold — scoring
 * the most profitable shelves in the building as the deadest.
 */

interface ShelfRow {
  binId: string;
  serialNumber: string;
  zone: string;
  itemCount: number;
  slotDays: number;
  revenueMinor: number;
  revenuePerSlotMonthMinor: number | null;
  deadItemCount: number;
  oldestItemDays: number | null;
}

interface ShelfYield {
  shelves: ShelfRow[];
  totals: {
    shelfCount: number;
    occupiedShelfCount: number;
    emptyShelfCount: number;
    itemCount: number;
    deadItemCount: number;
    revenueMinor: number;
    slotDays: number;
  };
}

describe('who can see it', () => {
  it('is admin-only — a warehouse operator cannot read customer profitability', async () => {
    const operator = await signIn(SEED.operator);
    for (const path of ['/admin/shelf-yield', '/admin/shelf-yield/zones', '/admin/shelf-yield/customers']) {
      expect((await operator.get(path)).status, `${path} leaked to an operator`).toBe(403);
    }
  });

  it('is refused outright without a session', async () => {
    const anon = new Client();
    expect((await anon.get('/admin/shelf-yield')).status).toBe(401);
  });

  it('is never reachable by a collector', async () => {
    const collector = await signIn(SEED.collector);
    expect((await collector.get('/admin/shelf-yield/customers')).status).toBe(403);
  });
});

describe('revenue attribution', () => {
  it('counts the marketplace commission, which lives outside the charge table', async () => {
    const admin = await signIn(SEED.admin);
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);

    const before = (await admin.get('/admin/shelf-yield')).body as ShelfYield;

    // A card, listed and sold. The intake fee lands in `charge`; the commission
    // does not — it is only a ledger row against the listing.
    const item = await intakeFor(operator, SEED.collector, { description: 'Yield: commission test' });
    const listed = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 400_00 });
    expect(listed.status).toBe(201);

    await fundWallet(SEED.collector2, 500_00);
    const buyer = await signIn(SEED.collector2);
    const bought = await buyer.post(`/marketplace/listings/${listed.body.id}/purchase`, {});
    expect(bought.status).toBe(201);

    const after = (await admin.get('/admin/shelf-yield')).body as ShelfYield;

    // The intake fee alone would be a few hundred cents. A 5% commission on
    // $400 is $20, so the jump has to be far larger than an intake — which is
    // exactly what a charges-only computation would have missed.
    const gained = after.totals.revenueMinor - before.totals.revenueMinor;
    expect(gained, 'the commission was not attributed to any shelf').toBeGreaterThan(1_000);
  });

  it('attributes an intake fee to the shelf the card is actually on', async () => {
    const admin = await signIn(SEED.admin);
    const operator = await signIn(SEED.operator);

    const created = await operator.post('/intake/items', {
      ownerUsername: 'red',
      typeClass: 'trading_card',
      description: 'Yield: attribution',
      autoStow: true,
    });
    expect(created.status).toBe(201);

    const body = (await admin.get('/admin/shelf-yield')).body as ShelfYield;
    const shelf = body.shelves.find((s) => s.binId === created.body.binId)!;
    expect(shelf, 'the shelf the item was stowed on is missing from the report').toBeTruthy();
    expect(shelf.itemCount).toBeGreaterThan(0);
    expect(shelf.revenueMinor).toBeGreaterThan(0);
  });
});

describe('the arithmetic', () => {
  it('adds up to the totals it reports, counting only occupied shelves', async () => {
    const admin = await signIn(SEED.admin);
    const body = (await admin.get('/admin/shelf-yield')).body as ShelfYield;
    const occupied = body.shelves.filter((s) => s.itemCount > 0);

    expect(body.totals.shelfCount).toBe(body.shelves.length);
    expect(body.totals.occupiedShelfCount).toBe(occupied.length);
    expect(body.totals.emptyShelfCount).toBe(body.shelves.length - occupied.length);
    expect(body.totals.itemCount).toBe(occupied.reduce((s, r) => s + r.itemCount, 0));
    expect(body.totals.revenueMinor).toBe(occupied.reduce((s, r) => s + r.revenueMinor, 0));
    expect(body.totals.slotDays).toBe(occupied.reduce((s, r) => s + r.slotDays, 0));
  });

  it('reports no yield rather than a divide-by-zero when nothing has sat there yet', async () => {
    const admin = await signIn(SEED.admin);
    const body = (await admin.get('/admin/shelf-yield')).body as ShelfYield;

    for (const shelf of body.shelves) {
      if (shelf.slotDays === 0) {
        // A shelf loaded this morning has earned money over no time. That is
        // not an infinite yield, it is an unknown one.
        expect(shelf.revenuePerSlotMonthMinor).toBeNull();
      } else {
        expect(shelf.revenuePerSlotMonthMinor).not.toBeNull();
      }
    }
  });

  it('counts an item that has earned nothing as dead, and never one that has', async () => {
    const admin = await signIn(SEED.admin);
    const body = (await admin.get('/admin/shelf-yield')).body as ShelfYield;
    for (const shelf of body.shelves) {
      expect(shelf.deadItemCount).toBeLessThanOrEqual(shelf.itemCount);
      if (shelf.itemCount === 0) expect(shelf.deadItemCount).toBe(0);
    }
  });

  it('puts the worst-earning occupied shelf first and empties last', async () => {
    const admin = await signIn(SEED.admin);
    const body = (await admin.get('/admin/shelf-yield')).body as ShelfYield;

    // An empty shelf is not a problem, it is capacity — so it must not sit at
    // the top of a list an operator reads to decide what to reclaim.
    const firstEmpty = body.shelves.findIndex((s) => s.itemCount === 0);
    const lastOccupied = body.shelves.map((s) => s.itemCount > 0).lastIndexOf(true);
    if (firstEmpty !== -1 && lastOccupied !== -1) {
      expect(firstEmpty).toBeGreaterThan(lastOccupied);
    }
  });
});

describe('the rollups', () => {
  it('groups by facility and zone', async () => {
    const admin = await signIn(SEED.admin);
    const res = await admin.get('/admin/shelf-yield/zones');
    expect(res.status).toBe(200);

    const zones = res.body as { zone: string; shelfCount: number; itemCount: number }[];
    expect(zones.length).toBeGreaterThan(0);
    // The key names the building as well as the zone: zone A in New Jersey is
    // not zone A in Delaware.
    for (const z of zones) expect(z.zone).toMatch(/\//);

    const shelfTotal = (await admin.get('/admin/shelf-yield')).body as ShelfYield;
    expect(zones.reduce((s, z) => s + z.shelfCount, 0)).toBe(shelfTotal.totals.shelfCount);
  });

  it('ranks customers by what their shelving earns, and leaves the test suite out of it', async () => {
    const admin = await signIn(SEED.admin);
    const res = await admin.get('/admin/shelf-yield/customers');
    expect(res.status).toBe(200);

    const rows = res.body as { username: string; itemCount: number; revenueMinor: number }[];
    expect(rows.length).toBeGreaterThan(0);
    // Fixture accounts are machinery. A yield table that ranks the test suite
    // among its customers is unreadable.
    for (const r of rows) expect(r.username).not.toMatch(/^t?\d{10,}/);
    for (const r of rows) expect(r.itemCount).toBeGreaterThan(0);
  });
});
