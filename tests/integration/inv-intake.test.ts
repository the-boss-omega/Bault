import { describe, it, expect } from 'vitest';
import { SEED, binIds, fundWallet, intakeFor, signIn, usernameOf } from './helpers/http';

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
