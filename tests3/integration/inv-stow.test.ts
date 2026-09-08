import { describe, it, expect } from 'vitest';
import { SEED, signIn, usernameOf, type Client } from '../../tests/integration/helpers/http';

/**
 * Directed stow, scanning, and closing a box out.
 *
 * These cover the intake workflow as an operator actually walks it, rather than
 * as a form submits it: the system says where a thing goes, the operator drives
 * every step with the barcodes Bault itself printed, and a parcel cannot be
 * closed out against nothing. Requires a running API + seeded DB.
 */

interface BinRow {
  id: string;
  serialNumber: string;
  barcode: string;
  zone: string;
  oversized: boolean;
  active: boolean;
  itemCount: number;
  facilityCode: string | null;
}

/**
 * A shelf serial: `BIN-` and eight characters from the unambiguous alphabet.
 * Notably NOT `BIN-A-001` — no zone in it, and no ordinal.
 */
const BIN_SERIAL = /^BIN-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

async function bins(operator: Client): Promise<BinRow[]> {
  const res = await operator.get('/custody/bins');
  expect(res.status).toBe(200);
  return res.body as BinRow[];
}

describe('directed stow', () => {
  it('has no capacity on a bin at all — a shelf reports what is on it', async () => {
    const operator = await signIn(SEED.operator);
    const list = await bins(operator);
    expect(list.length).toBeGreaterThan(0);
    for (const b of list) {
      expect(b).not.toHaveProperty('capacity');
      expect(typeof b.itemCount).toBe('number');
      expect(typeof b.active).toBe('boolean');
    }
  });

  it('identifies every shelf by a minted serial, never by a zone-and-number name', async () => {
    const operator = await signIn(SEED.operator);
    const list = await bins(operator);

    for (const b of list) {
      expect(b.serialNumber).toMatch(BIN_SERIAL);
      // One string on the label: the barcode IS the serial, as it is for an item.
      expect(b.barcode).toBe(b.serialNumber);
      // The zone survives as a label, and is not part of the identity.
      expect(b.serialNumber).not.toContain(`-${b.zone.toUpperCase()}-`);
    }
    // And they are distinct, which a per-zone counter could not promise across
    // two operators building out the same zone at once.
    expect(new Set(list.map((b) => b.serialNumber)).size).toBe(list.length);
  });

  it('mints the serial itself, and refuses one a caller tries to name', async () => {
    const operator = await signIn(SEED.operator);

    // A shelf that can be named is a shelf whose identity encodes a zone it may
    // be moved out of and an ordinal that races the next operator. The create
    // DTO carries no such field, and the API rejects unknown ones outright
    // rather than accepting and quietly discarding them.
    const named = await operator.post('/custody/bins', { zone: 'A', barcode: 'BIN-A-001' });
    expect(named.status).toBe(400);

    const made = await operator.post('/custody/bins', { zone: 'A' });
    expect(made.status).toBe(201);
    expect(made.body.serialNumber).toMatch(BIN_SERIAL);
    expect(made.body.barcode).toBe(made.body.serialNumber);
  });

  it('suggests the emptiest active standard shelf, and stows there', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);

    const suggested = await operator.get('/custody/bins/suggest');
    expect(suggested.status).toBe(200);
    expect(suggested.body.serialNumber).toMatch(BIN_SERIAL);
    expect(suggested.body.oversized).toBe(false);

    // Nothing on any other eligible shelf is emptier than the one handed out.
    const stowable = (await operator.get('/custody/bins/stowable')).body as BinRow[];
    for (const b of stowable) {
      expect(b.itemCount).toBeGreaterThanOrEqual(suggested.body.itemCount);
    }

    const before = suggested.body.itemCount as number;
    const created = await operator.post('/intake/items', {
      ownerUsername,
      typeClass: 'trading_card',
      autoStow: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.binId).toBe(suggested.body.id);

    // The shelf it was sent to is one item fuller, so the next unit may well be
    // directed somewhere else — that is the whole point of spreading the load.
    const after = (await bins(operator)).find((b) => b.id === suggested.body.id);
    expect(after?.itemCount).toBe(before + 1);
  });

  it('sends an oversized class to oversized shelving, never to a card shelf', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);

    const created = await operator.post('/intake/items', {
      ownerUsername,
      // A sealed case is oversized in the taxonomy.
      typeClass: 'sealed_case',
      description: 'Sealed case, oversized shelving',
      autoStow: true,
    });
    expect(created.status).toBe(201);

    const shelf = (await bins(operator)).find((b) => b.id === created.body.binId);
    expect(shelf?.oversized).toBe(true);
    // And the storage terms were fixed from the same class at receipt.
    expect(created.body.oversized).toBe(true);
  });

  it('still refuses an intake that names no shelf and does not ask for one', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const res = await operator.post('/intake/items', { ownerUsername, typeClass: 'trading_card' });
    expect(res.status).toBe(400);
  });
});

describe('scanning', () => {
  it('accepts the shelf BARCODE at intake, not only the internal id', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const shelf = (await bins(operator)).find((b) => b.active && !b.oversized)!;

    const created = await operator.post('/intake/items', {
      ownerUsername,
      typeClass: 'trading_card',
      binId: shelf.barcode,
    });
    expect(created.status).toBe(201);
    expect(created.body.binId).toBe(shelf.id);
  });

  it('relocates by the barcodes printed on the item and the shelf', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const shelves = (await bins(operator)).filter((b) => b.active && !b.oversized);

    const created = await operator.post('/intake/items', {
      ownerUsername,
      typeClass: 'trading_card',
      binId: shelves[0]!.barcode,
    });
    expect(created.status).toBe(201);
    const destination = shelves.find((b) => b.id !== created.body.binId)!;

    // Both ends of the move are the strings on the physical labels.
    const moved = await operator.post(`/custody/items/${created.body.barcode}/relocate`, {
      binId: destination.barcode,
    });
    expect(moved.status).toBe(201);
    expect(moved.body.itemId).toBe(created.body.id);
    expect(moved.body.binId).toBe(destination.id);

    const history = await operator.get(`/custody/items/${created.body.id}/history`);
    const move = (history.body as { eventType: string; newBinId: string }[]).find(
      (e) => e.eventType === 'relocate',
    );
    expect(move?.newBinId).toBe(destination.id);
  });

  it('says so plainly when a scan matches nothing', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const res = await operator.post('/intake/items', {
      ownerUsername,
      typeClass: 'trading_card',
      binId: 'BIN-NOPE-999',
    });
    expect(res.status).toBe(400);
  });
});

describe('a shelf out of service', () => {
  it('is never directed to, and refuses an intake aimed at it', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);

    // A shelf of its own, so taking it out of service disturbs nothing else.
    const made = await operator.post('/custody/bins', { zone: `RETIRE${Date.now() % 100000}` });
    expect(made.status).toBe(201);
    const shelf = made.body as BinRow;

    const retired = await operator.patch(`/custody/bins/${shelf.id}`, { active: false });
    expect(retired.status).toBe(200);
    expect(retired.body.active).toBe(false);

    const stowable = (await operator.get('/custody/bins/stowable')).body as BinRow[];
    expect(stowable.some((b) => b.id === shelf.id)).toBe(false);

    const refused = await operator.post('/intake/items', {
      ownerUsername,
      typeClass: 'trading_card',
      binId: shelf.barcode,
    });
    expect(refused.status).toBe(400);

    // It comes back, because it was never deleted.
    const returned = await operator.patch(`/custody/bins/${shelf.id}`, { active: true });
    expect(returned.body.active).toBe(true);
  });
});

describe('a parcel is closed out against what came out of it', () => {
  it('walks receive → open → book contents → close out', async () => {
    const operator = await signIn(SEED.operator);
    const collectorUsername = await usernameOf(SEED.collector);

    const received = await operator.post('/parcels/receive', {
      facilityCode: 'NJ',
      addressedTo: collectorUsername,
      carrier: 'USPS',
      trackingNumber: `STOW-${Date.now()}`,
    });
    expect(received.status).toBe(201);
    const parcelId = received.body.id as string;

    const opened = await operator.post(`/parcels/${parcelId}/open`, {
      condition: 'sound',
      conditionNotes: 'Box intact, two slabs inside',
    });
    expect(opened.status).toBe(201);

    // Nothing has come out of it yet, so closing it is refused rather than
    // silently billed.
    const premature = await operator.post(`/parcels/${parcelId}/process`);
    expect(premature.status).toBe(409);

    const booked = await operator.post('/intake/items', {
      ownerUsername: collectorUsername,
      typeClass: 'graded_slab',
      description: 'Out of the parcel',
      autoStow: true,
      parcelId,
      quantity: 2,
    });
    expect(booked.status).toBe(201);
    expect(booked.body).toHaveLength(2);

    // The bench can see the count without leaving the page.
    const queue = (await operator.get('/parcels')).body as { id: string; itemCount: number }[];
    expect(queue.find((p) => p.id === parcelId)?.itemCount).toBe(2);

    const closed = await operator.post(`/parcels/${parcelId}/process`);
    expect(closed.status).toBe(201);
    expect(closed.body.itemCount).toBe(2);

    // …and it cannot be closed, or charged, twice.
    const again = await operator.post(`/parcels/${parcelId}/process`);
    expect(again.status).toBe(409);
  });

  it('closes a genuinely empty parcel only against a stated reason', async () => {
    const operator = await signIn(SEED.operator);
    const collectorUsername = await usernameOf(SEED.collector);

    const received = await operator.post('/parcels/receive', {
      facilityCode: 'NJ',
      addressedTo: collectorUsername,
      trackingNumber: `EMPTY-${Date.now()}`,
    });
    const parcelId = received.body.id as string;
    await operator.post(`/parcels/${parcelId}/open`, {
      condition: 'packaging_damaged',
      conditionNotes: 'Corner torn open in transit',
    });

    expect((await operator.post(`/parcels/${parcelId}/process`)).status).toBe(409);

    const closed = await operator.post(`/parcels/${parcelId}/process`, {
      emptyReason: 'Arrived empty — contents lost in transit, carrier claim opened',
    });
    expect(closed.status).toBe(201);
    expect(closed.body.itemCount).toBe(0);
  });
});
