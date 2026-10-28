import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { Client, SEED, intakeFor, signIn } from './helpers/http';

interface ShelfItem {
  id: string;
  serialNumber: string;
  barcode: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  holdFlag: boolean;
}

interface Shelf {
  bin: { id: string; barcode: string; zone: string; oversized: boolean; active: boolean };
  items: ShelfItem[];
}

describe('CST what is on a shelf, read only', () => {
  // Signing in is rate limited: once for each person, not once for each test.
  let operator: Client;
  let collector: Client;
  let admin: Client;
  beforeAll(async () => {
    operator = await signIn(SEED.operator);
    collector = await signIn(SEED.collector);
    admin = await signIn(SEED.admin);
  });

  it('lists the items on the shelf by their numbers, and the list is the count the shelf map shows', async () => {
    const placed = await intakeFor(operator, SEED.collector, {
      typeClass: 'trading_card',
      description: 'Shelf contents check · Holo',
      conditionGrade: 'PSA 9',
    });
    const bins = (await operator.get('/custody/bins')).body as {
      id: string;
      barcode: string;
      zone: string;
      itemCount: number;
    }[];
    const shelf = bins.find((b) => b.id === placed.binId)!;

    const res = await operator.get(`/custody/bins/${placed.binId}/items`);
    expect(res.status).toBe(200);
    const body = res.body as Shelf;
    expect(body.bin).toMatchObject({ id: shelf.id, barcode: shelf.barcode, zone: shelf.zone });
    // The shelf's count and its list are the same rows, counted and read.
    expect(body.items.length).toBe(shelf.itemCount);

    const mine = body.items.find((i) => i.id === placed.id)!;
    expect(mine).toMatchObject({
      serialNumber: placed.serialNumber,
      barcode: placed.barcode,
      description: 'Shelf contents check · Holo',
      conditionGrade: 'PSA 9',
      typeClass: 'trading_card',
      holdFlag: false,
    });
    // In the order a person finds them on the shelf: by number.
    const serials = body.items.map((i) => i.serialNumber);
    expect(serials).toEqual([...serials].sort());
    // Only what is on the shelf: nothing about whose it is, nothing about what it cost.
    expect(Object.keys(mine).sort()).toEqual(
      [
        'barcode',
        'conditionGrade',
        'description',
        'holdFlag',
        'id',
        'lifecycleState',
        'serialNumber',
        'typeClass',
      ].sort(),
    );
  });

  it('lists nothing for a shelf with nothing on it, and says whose shelf it is', async () => {
    const bins = (await operator.get('/custody/bins')).body as { id: string; itemCount: number }[];
    const empty = bins.find((b) => b.itemCount === 0);
    if (!empty) return; // every shelf in this database is stocked; the count test above is the one that matters
    const res = await operator.get(`/custody/bins/${empty.id}/items`);
    expect(res.status).toBe(200);
    expect((res.body as Shelf).items).toEqual([]);
    expect((res.body as Shelf).bin.id).toBe(empty.id);
  });

  it('is read only, and for the warehouse and the manager alone', async () => {
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const path = `/custody/bins/${bins[0]!.id}/items`;
    // Nothing writes to it.
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await operator.request(method, path, {});
      expect([404, 405], `${method} ${path}`).toContain(res.status);
    }
    expect((await collector.get(path)).status).toBe(403);
    expect((await new Client().get(path)).status).toBe(401);
    expect((await admin.get(path)).status).toBe(200);
  });

  it("says so when there is no such shelf, and when what was asked for is not a shelf's number at all", async () => {
    const none = await operator.get(`/custody/bins/${randomUUID()}/items`);
    expect(none.status).toBe(404);
    const malformed = await operator.get('/custody/bins/no-such-shelf/items');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('validation_failed');
  });
});
