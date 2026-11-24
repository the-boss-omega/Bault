import { afterAll, describe, it, expect } from 'vitest';
import { SEED, binIds, fundWallet, intakeFor, signIn, usernameOf } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

describe('INV intake & custody', () => {
  it('intakes an item for the routed owner, then the owner sees it in their vault', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, {
      description: '2003 EX Dragon Rayquaza ex #97/97',
      conditionGrade: 'PSA 9',
    });
    expect(item.ownerId).toBeTruthy();
    expect(item.lifecycleState).toBe('stored');
    expect(item.binId).toBeTruthy();
    expect(item.serialNumber).toMatch(/^SN-/);
    expect(item.barcode).toBe(item.serialNumber);
    const itemId = item.id as string;

    const history = await operator.get(`/custody/items/${itemId}/history`);
    expect(history.status).toBe(200);
    expect(history.body.some((e: any) => e.eventType === 'intake')).toBe(true);

    const collector = await signIn(SEED.collector);
    const vault = await collector.get('/vault/items');
    const mine = (vault.body as any[]).find((i) => i.id === itemId);
    expect(mine).toBeTruthy();
    expect(mine.binBarcode).toBeUndefined();
    expect((history.body as { eventType: string; newBinId: string | null }[]).find((e) => e.eventType === 'intake')?.newBinId).toBeTruthy();
  });

  it('rejects an intake that neither names a bin nor asks for one', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const res = await operator.post('/intake/items', { ownerUsername, typeClass: 'trading_card' });
    expect(res.status).toBe(400);
  });

  it('performs a bulk intake of N items in one action (Requirement 10.1)', async () => {
    const operator = await signIn(SEED.operator);
    const created = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card', quantity: 3 });
    expect(Array.isArray(created)).toBe(true);
    expect(created).toHaveLength(3);
    const barcodes = new Set((created as any[]).map((i) => i.barcode));
    expect(barcodes.size).toBe(3);
  });

  it('stores a lot as ONE item and breaks it into standalone items (Req 10.5)', async () => {
    const operator = await signIn(SEED.operator);
    const lot = await intakeFor(operator, SEED.collector, {
      typeClass: 'sealed_box',
      isLot: true,
      lotSize: 4,
    });
    expect(lot.isLot).toBe(true);
    expect(lot.serialNumber).toMatch(/^LOT-/);

    const open = await operator.get('/intake/lots');
    expect((open.body as any[]).some((l) => l.id === lot.id)).toBe(true);

    const broken = await operator.post(`/intake/items/${lot.id}/break-lot`);
    expect(broken.status).toBe(201);
    expect(broken.body.producedCount).toBe(4);
    const second = await operator.post(`/intake/items/${lot.id}/break-lot`);
    expect(second.status).toBe(400);
  });

  it('stops counting a split lot as shelf stock or as storage that accrues (F006)', async () => {
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector);
    const lot = await intakeFor(operator, SEED.collector, { typeClass: 'sealed_box', isLot: true, lotSize: 3 });
    const binCount = async () =>
      ((await operator.get('/custody/bins')).body as { id: string; itemCount: number }[]).find((b) => b.id === lot.binId)!
        .itemCount;
    const yieldCount = async () =>
      ((await admin.get('/admin/shelf-yield')).body.shelves as { binId: string; itemCount: number }[]).find(
        (s) => s.binId === lot.binId,
      )?.itemCount ?? 0;
    const shelfBefore = await binCount();
    const yieldBefore = await yieldCount();

    const broken = await operator.post(`/intake/items/${lot.id}/break-lot`);
    expect(broken.status).toBe(201);

    expect(await binCount()).toBe(shelfBefore - 1 + 3);
    expect(await yieldCount()).toBe(yieldBefore - 1 + 3);

    const storage = await collector.get(`/vault/items/${lot.id}/storage`);
    expect(storage.status).toBe(200);
    expect(storage.body.nextChargeAt).toBeNull();
  });

  it('records a correction in change history and relocates with source + destination', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'small_collectible' });
    const itemId = item.id as string;
    const bins = await binIds(operator);
    const destination = bins.find((id) => id !== item.binId) ?? bins[1];

    const corrected = await operator.patch(`/intake/items/${itemId}`, {
      patches: [{ field: 'description', value: 'Silver dollar 1921' }],
    });
    expect(corrected.status).toBe(200);

    const relocate = await operator.post(`/custody/items/${itemId}/relocate`, { binId: destination });
    expect(relocate.status).toBe(201);

    const history = await operator.get(`/custody/items/${itemId}/history`);
    const move = (history.body as any[]).find((e) => e.eventType === 'relocate');
    expect(move).toBeTruthy();
    expect(move.prevBinId).toBe(item.binId);
    expect(move.newBinId).toBe(destination);

    const timeline = await operator.get(`/custody/items/${itemId}/timeline`);
    expect((timeline.body as any[]).some((e) => e.kind === 'bin_transfer')).toBe(true);
  });

  it('blocks a customer from the operator-only intake endpoint', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/intake/items', {
      ownerUsername: await usernameOf(SEED.collector),
      typeClass: 'other',
      binId: 'irrelevant',
    });
    expect(res.status).toBe(403);
  });
});

describe('an item booked in without a shelf', () => {
  it('books it in with no bin and a reason, lists it to shelve for staff, and stows it later', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    const ownerUsername = await usernameOf(SEED.collector);
    const reason = 'Waiting for grading';

    const booked = await operator.post('/intake/items', {
      ownerUsername,
      typeClass: 'trading_card',
      description: 'Rayquaza VMAX 218/203',
      placement: 'later',
      placementReason: reason,
    });
    expect(booked.status).toBe(201);
    expect(booked.body.binId).toBeNull();
    expect(booked.body.placementUndecidedReason).toBe(reason);
    expect(booked.body.placementUndecidedAt).toBeTruthy();
    expect(booked.body.lifecycleState).toBe('stored');
    const itemId = booked.body.id as string;

    const vault = await collector.get('/vault/items');
    expect(vault.status).toBe(200);
    expect((vault.body as { id: string }[]).some((i) => i.id === itemId)).toBe(true);

    const card = await collector.get(`/vault/items/${itemId}`);
    expect(card.status).toBe(200);
    expect(JSON.stringify(card.body)).not.toContain(reason);
    expect(card.body.item.placementUndecidedReason).toBeUndefined();
    expect(card.body.item.placementUndecidedAt).toBeUndefined();

    const queue = await operator.get('/custody/to-shelve');
    expect(queue.status).toBe(200);
    const row = (queue.body as any[]).find((r) => r.itemId === itemId);
    expect(row).toBeTruthy();
    expect(row.ownerUsername).toBe(ownerUsername);
    expect(row.reason).toBe(reason);
    expect(row).toHaveProperty('parcelCode');
    expect(typeof row.waitingSeconds).toBe('number');
    const waits = (queue.body as { placementUndecidedAt: string }[]).map((r) => Date.parse(r.placementUndecidedAt));
    expect(waits).toEqual([...waits].sort((a, b) => a - b));

    expect((await collector.get('/custody/to-shelve')).status).toBe(403);

    const [shelf] = await binIds(operator);
    const stowed = await operator.post(`/custody/items/${itemId}/relocate`, { binId: shelf });
    expect(stowed.status).toBe(201);

    const after = await operator.get('/custody/to-shelve');
    expect((after.body as any[]).some((r) => r.itemId === itemId)).toBe(false);

    const history = await operator.get(`/custody/items/${itemId}/history`);
    const move = (history.body as any[]).find((e) => e.eventType === 'relocate');
    expect(move).toBeTruthy();
    expect(move.prevBinId).toBeNull();
    expect(move.newBinId).toBe(shelf);

    const card2 = await collector.get(`/vault/items/${itemId}`);
    expect(card2.status).toBe(200);
    expect(JSON.stringify(card2.body)).not.toContain(reason);
  });

  it('lists, sells and quotes shipping for an unshelved item as for any other', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const booked = await operator.post('/intake/items', {
      ownerUsername,
      typeClass: 'trading_card',
      placement: 'later',
      placementReason: 'Shelf full',
    });
    expect(booked.status).toBe(201);
    const itemId = booked.body.id as string;

    const seller = await signIn(SEED.collector);
    const address = await seller.post('/me/addresses', {
      label: 'Trenton',
      recipient: 'Red Ashwood',
      line1: '12 Vine St',
      city: 'Trenton',
      region: 'NJ',
      country: 'US',
      postalCode: '08608',
    });
    expect(address.status).toBe(201);
    const quote = await seller.post('/shipping/quote', { itemIds: [itemId], addressId: address.body.id });
    expect(quote.status).toBe(201);
    expect(quote.body.rates.length).toBeGreaterThan(0);

    const listing = await seller.post('/marketplace/listings', { itemId, askingPrice: 1500 });
    expect(listing.status).toBe(201);

    await fundWallet(SEED.collector2, 5000);
    const buyer = await signIn(SEED.collector2);
    const bought = await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`);
    expect(bought.status).toBe(201);
    expect(((await buyer.get('/vault/items')).body as { id: string }[]).some((i) => i.id === itemId)).toBe(true);

    const queue = await operator.get('/custody/to-shelve');
    expect((queue.body as any[]).some((r) => r.itemId === itemId)).toBe(true);
  });

  it('asks for a reason when the shelf is left for later', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const res = await operator.post('/intake/items', { ownerUsername, typeClass: 'trading_card', placement: 'later' });
    expect(res.status).toBe(400);
  });
});

async function openParcelFor(operator: Awaited<ReturnType<typeof signIn>>, ownerUsername: string) {
  const received = await operator.post('/parcels/receive', {
    facilityCode: 'NJ',
    addressedTo: ownerUsername,
    trackingNumber: `INTAKE-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  });
  expect(received.status).toBe(201);
  const parcelId = received.body.id as string;
  const opened = await operator.post(`/parcels/${parcelId}/open`, { condition: 'sound', conditionNotes: 'Box intact.' });
  expect(opened.status).toBe(201);
  return parcelId;
}

async function intakeChargesFor(itemIds: readonly string[]): Promise<number> {
  const rows = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM charge WHERE action_type = 'intake' AND reference_id = any($1)`,
    [itemIds],
  );
  return rows[0]!.n;
}

describe('an intake sent twice', () => {
  it('books and bills once when the same units from one parcel are sent again with no key', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const parcelId = await openParcelFor(operator, ownerUsername);
    const body = {
      units: [
        { ownerUsername, typeClass: 'trading_card', autoStow: true, parcelId, description: 'Retry card A' },
        { ownerUsername, typeClass: 'trading_card', autoStow: true, parcelId, description: 'Retry card B' },
      ],
    };

    const first = await operator.post('/intake/items/batch', body);
    expect(first.status).toBe(201);
    const again = await operator.post('/intake/items/batch', body);
    expect(again.status).toBe(201);
    expect((again.body as { id: string }[]).map((i) => i.id)).toEqual((first.body as { id: string }[]).map((i) => i.id));

    const booked = await sql<{ id: string }>(`SELECT id::text AS id FROM item WHERE source_parcel_id = $1`, [parcelId]);
    expect(booked).toHaveLength(2);
    expect(await intakeChargesFor(booked.map((r) => r.id))).toBe(2);
  });

  it('replays the first answer for a repeated Idempotency-Key on a single intake', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const key = `intake-retry-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const body = { ownerUsername, typeClass: 'trading_card', autoStow: true, description: 'Keyed retry' };

    const first = await operator.post('/intake/items', body, { 'idempotency-key': key });
    expect(first.status).toBe(201);
    const again = await operator.post('/intake/items', body, { 'idempotency-key': key });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await intakeChargesFor([first.body.id as string])).toBe(1);
  });

  it('books two items when two identical single intakes carry no parcel and no key', async () => {
    const operator = await signIn(SEED.operator);
    const first = await intakeFor(operator, SEED.collector, { description: 'Two of the same' });
    const second = await intakeFor(operator, SEED.collector, { description: 'Two of the same' });
    expect(second.id).not.toBe(first.id);
  });
});

describe('intake refusals in plain words', () => {
  it('refuses a small lot with a quantity instead of booking only the lot size', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const res = await operator.post('/intake/items', {
      ownerUsername,
      typeClass: 'trading_card',
      autoStow: true,
      isLot: true,
      lotSize: 5,
      quantity: 40,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/single cards/);
  });

  it('answers a malformed parcel id in a batch without the query text', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const res = await operator.post('/intake/items/batch', {
      units: [{ ownerUsername, typeClass: 'trading_card', autoStow: true, parcelId: 'nope' }],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/Failed query|params|select /i);
  });

  it('names a typed serial that is already taken, in a batch and alone, without the query text', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const serialNumber = `SN-TYPED-${Date.now()}`;
    const first = await operator.post('/intake/items', { ownerUsername, typeClass: 'trading_card', autoStow: true, serialNumber });
    expect(first.status).toBe(201);

    const alone = await operator.post('/intake/items', {
      ownerUsername,
      typeClass: 'trading_card',
      autoStow: true,
      serialNumber,
      description: 'A different card',
    });
    expect(alone.status).toBe(409);
    expect(alone.body.error.message).toContain(`Serial ${serialNumber} is already on another item`);

    const batch = await operator.post('/intake/items/batch', {
      units: [{ ownerUsername, typeClass: 'trading_card', autoStow: true, serialNumber, description: 'Third try' }],
    });
    expect(batch.status).toBeGreaterThanOrEqual(400);
    expect(batch.body.error.message).toContain('is already on another item');
    expect(JSON.stringify(batch.body)).not.toMatch(/Failed query|params|insert into/i);
  });

  it('refuses a typed barcode that is another item’s serial, so one scan cannot match two items', async () => {
    const operator = await signIn(SEED.operator);
    const stamp = Date.now();
    const red = await intakeFor(operator, SEED.collector, { serialNumber: `SN-A-${stamp}`, barcode: `SN-B-${stamp}` });
    expect(red.barcode).toBe(`SN-B-${stamp}`);
    const golden = await operator.post('/intake/items', {
      ownerUsername: await usernameOf(SEED.collector2),
      typeClass: 'trading_card',
      autoStow: true,
      serialNumber: `SN-C-${stamp}`,
      barcode: `sn-a-${stamp}`,
    });
    expect(golden.status).toBe(409);
    expect(golden.body.error.message).toContain('is already on another item');
  });

  it('refuses an oversized class on a standard shelf', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const shelves = (await operator.get('/custody/bins')).body as { id: string; oversized: boolean; active: boolean }[];
    const standard = shelves.find((b) => b.active && !b.oversized)!;
    const res = await operator.post('/intake/items', { ownerUsername, typeClass: 'sealed_case', binId: standard.id });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/oversized/i);
  });
});

describe('a lot split later', () => {
  it('keeps the lot’s arrival date on every piece and tells the owner about each one', async () => {
    const operator = await signIn(SEED.operator);
    const lot = await intakeFor(operator, SEED.collector, { typeClass: 'sealed_box', isLot: true, lotSize: 2 });
    await sql(`UPDATE item SET received_at = now() - interval '200 days' WHERE id = $1`, [lot.id]);
    const broken = await operator.post(`/intake/items/${lot.id}/break-lot`);
    expect(broken.status).toBe(201);
    const childIds = (broken.body.items as { id: string }[]).map((i) => i.id);
    const rows = await sql<{ same: boolean }>(
      `SELECT abs(extract(epoch from c.received_at - l.received_at)) < 0.001 AS same
         FROM item c, item l WHERE l.id = $1 AND c.id = any($2)`,
      [lot.id, childIds],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.same)).toBe(true);
    const notices = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_message WHERE event_type = 'item_received' AND aggregate_id = any($1)`,
      [childIds],
    );
    expect(notices[0]!.n).toBe(2);
  });
});

describe('corrections', () => {
  it('records each patch against the value before it, and refuses a non-lot class on a lot', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'First' });
    const res = await operator.patch(`/intake/items/${item.id}`, {
      patches: [
        { field: 'description', value: 'Second' },
        { field: 'description', value: 'Third' },
      ],
    });
    expect(res.status).toBe(200);
    const rows = await sql<{ old_value: string; new_value: string }>(
      `SELECT old_value, new_value FROM item_change_history WHERE item_id = $1 ORDER BY new_value`,
      [item.id],
    );
    expect(rows.map((r) => [r.old_value, r.new_value])).toEqual([
      ['First', 'Second'],
      ['Second', 'Third'],
    ]);

    const lot = await intakeFor(operator, SEED.collector, { typeClass: 'sealed_box', isLot: true, lotSize: 3 });
    const bad = await operator.patch(`/intake/items/${lot.id}`, { patches: [{ field: 'typeClass', value: 'sealed_case' }] });
    expect(bad.status).toBe(400);

    const many = await operator.patch(`/intake/items/${item.id}`, {
      patches: Array.from({ length: 51 }, (_, i) => ({ field: 'description', value: `v${i}` })),
    });
    expect(many.status).toBe(400);
  });
});
