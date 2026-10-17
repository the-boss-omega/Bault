import { describe, it, expect } from 'vitest';
import { SEED, binIds, intakeFor, signIn, usernameOf } from './helpers/http';

/**
 * Intake creates item + custody + charge; correction keeps history; relocate
 * logs custody AND a transfer-ledger row (Req 10.3/10.4).
 * Requires a running API + seeded DB.
 */
describe('INV intake & custody', () => {
  it('intakes an item for the routed owner, then the owner sees it in their vault', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, {
      description: '2003 EX Dragon Rayquaza ex #97/97',
      conditionGrade: 'PSA 9',
    });
    expect(item.ownerId).toBeTruthy();
    expect(item.lifecycleState).toBe('stored');
    // Every item is shelved on intake — a bin is mandatory (Requirement 10.3).
    expect(item.binId).toBeTruthy();
    // Item labels carry the SN- prefix (Requirement 9.2), and the barcode is the serial.
    expect(item.serialNumber).toMatch(/^SN-/);
    expect(item.barcode).toBe(item.serialNumber);
    const itemId = item.id as string;

    // Custody history has the intake event.
    const history = await operator.get(`/custody/items/${itemId}/history`);
    expect(history.status).toBe(200);
    expect(history.body.some((e: any) => e.eventType === 'intake')).toBe(true);

    // Owner sees it in their vault, with the bin resolved to a readable label.
    const collector = await signIn(SEED.collector);
    const vault = await collector.get('/vault/items');
    const mine = (vault.body as any[]).find((i) => i.id === itemId);
    expect(mine).toBeTruthy();
    expect(mine.binBarcode).toBeTruthy();
  });

  /**
   * Every item ends up on a shelf (Requirement 10.3). An intake may name a bin,
   * or ask for one with `autoStow`; one that does neither has nowhere to put the
   * goods and is refused. The directed-stow half of that is covered in
   * `tests3/integration/inv-stow.test.ts`.
   */
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
    // Each copy is individually tracked with its own unique label.
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
    // Once broken it is no longer offered for breaking again.
    const second = await operator.post(`/intake/items/${lot.id}/break-lot`);
    expect(second.status).toBe(400);
  });

  /**
   * The split lot stays `stored` on its shelf as the record its cards came
   * from. Nothing that counts what is on a shelf, or what is still costing its
   * owner storage, may count it as well as the cards.
   */
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

    // Three cards arrived on the shelf and the lot did not: it is the same goods.
    expect(await binCount()).toBe(shelfBefore - 1 + 3);
    expect(await yieldCount()).toBe(yieldBefore - 1 + 3);

    // Nothing more will be charged on the lot, so no next charge is named.
    const storage = await collector.get(`/vault/items/${lot.id}/storage`);
    expect(storage.status).toBe(200);
    expect(storage.body.nextChargeAt).toBeNull();

    // Break-Even Watch still lists it, as the vault does, with nothing more to pay.
    const watch = (await collector.get('/vault/break-even')).body as {
      items: { itemId: string; projectedYearMinor: number }[];
    };
    expect(watch.items.find((i) => i.itemId === lot.id)?.projectedYearMinor).toBe(0);
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
    // Both the OLD and the NEW bin are recorded (Requirement 10.4).
    expect(move.prevBinId).toBe(item.binId);
    expect(move.newBinId).toBe(destination);

    // …and the move also lands on the dedicated transfer ledger.
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
