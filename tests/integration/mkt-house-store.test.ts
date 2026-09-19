import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, signIn } from './helpers/http';

/**
 * The Bault store — the business selling its own cards.
 *
 * What makes this different from every other sale is that the card has no record
 * until it is bought: no serial, no barcode, no owner. So the tests that matter
 * are the ones about that record coming into existence — at the moment of payment,
 * owned by the buyer, on the record but not yet on a shelf — and about the
 * warehouse finishing the physical half.
 *
 * Requires a running API + a seeded DB.
 */
describe('MKT the Bault store', () => {
  const PRINT =
    '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo (Shiny Legendary subset) · art by Noriko Hotta · col1-SL10';

  async function product(stock: number, askingPrice = 3_500) {
    const admin = await signIn(SEED.admin);
    const res = await admin.post('/marketplace/house/listings', {
      typeClass: 'trading_card',
      description: PRINT,
      conditionGrade: 'Raw',
      photoRef: 'SN-CL10-0005',
      askingPrice,
      stock,
    });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^HSE-/);
    return res.body as { id: string; code: string };
  }

  it('sells a copy by minting the buyer an item with its own serial and barcode', async () => {
    const p = await product(2);
    await fundWallet(SEED.collector, 10_000);
    const collector = await signIn(SEED.collector);
    const before = (await collector.get('/finance/wallet')).body.amount as number;

    const bought = await collector.post(`/marketplace/house/listings/${p.id}/purchase`);
    expect(bought.status).toBe(201);
    expect(bought.body.serialNumber).toMatch(/^SN-/);
    expect(bought.body.barcode).toBe(bought.body.serialNumber);
    expect(bought.body.orderCode).toMatch(/^ORD-/);

    // Paid for exactly the asking price — no intake fee on a card that was Bault's.
    const after = (await collector.get('/finance/wallet')).body.amount as number;
    expect(before - after).toBe(3_500);

    // On the record and in the vault at once, but not on a shelf yet.
    const vault = (await collector.get('/vault/items')).body as Array<Record<string, unknown>>;
    const mine = vault.find((i) => i.id === bought.body.itemId);
    expect(mine).toBeDefined();
    expect(mine!.lifecycleState).toBe('received');
    expect(mine!.description).toBe(PRINT);

    // One copy fewer on the shelf.
    const shelf = (await collector.get('/marketplace/house/listings')).body as Array<{ id: string; stock: number }>;
    expect(shelf.find((l) => l.id === p.id)?.stock).toBe(1);
  });

  it('lets the same collector buy a second copy rather than replaying the first', async () => {
    const p = await product(2);
    await fundWallet(SEED.collector2, 10_000);
    const golden = await signIn(SEED.collector2);

    const first = await golden.post(`/marketplace/house/listings/${p.id}/purchase`);
    const second = await golden.post(`/marketplace/house/listings/${p.id}/purchase`);
    expect(second.status).toBe(201);
    expect(second.body.replayed).toBeUndefined();
    expect(second.body.serialNumber).not.toBe(first.body.serialNumber);
  });

  it('refuses the copy after the last one', async () => {
    const p = await product(1, 1_000);
    await fundWallet(SEED.collector, 5_000);
    const collector = await signIn(SEED.collector);

    expect((await collector.post(`/marketplace/house/listings/${p.id}/purchase`)).status).toBe(201);
    const late = await collector.post(`/marketplace/house/listings/${p.id}/purchase`);
    expect(late.status).toBe(409);

    const shelf = (await collector.get('/marketplace/house/listings')).body as Array<{ id: string }>;
    expect(shelf.some((l) => l.id === p.id)).toBe(false);
  });

  it('puts the order in the warehouse queue, and shelving it finishes the sale', async () => {
    const p = await product(1);
    await fundWallet(SEED.collector, 10_000);
    const collector = await signIn(SEED.collector);
    const bought = (await collector.post(`/marketplace/house/listings/${p.id}/purchase`)).body;

    const operator = await signIn(SEED.operator);
    const queue = (await operator.get('/marketplace/house/orders/queue')).body as Array<Record<string, unknown>>;
    const row = queue.find((o) => o.itemId === bought.itemId);
    expect(row).toBeDefined();
    expect(row!.barcode).toBe(bought.barcode);
    expect(row!.photoRef).toBe('SN-CL10-0005');

    const stowed = await operator.post(`/marketplace/house/orders/${row!.id}/stow`, { autoStow: true });
    expect(stowed.status).toBe(201);
    expect(stowed.body.binBarcode).toMatch(/^BIN-/);

    const vault = (await collector.get('/vault/items')).body as Array<Record<string, unknown>>;
    expect(vault.find((i) => i.id === bought.itemId)!.lifecycleState).toBe('stored');

    // Gone from the queue, and cannot be shelved twice.
    const again = (await operator.get('/marketplace/house/orders/queue')).body as Array<{ id: string }>;
    expect(again.some((o) => o.id === row!.id)).toBe(false);
    expect((await operator.post(`/marketplace/house/orders/${row!.id}/stow`, { autoStow: true })).status).toBe(409);
  });

  it('keeps managing the store to admins and shelving to staff', async () => {
    const collector = await signIn(SEED.collector);
    const operator = await signIn(SEED.operator);
    const body = { typeClass: 'trading_card', description: PRINT, askingPrice: 100, stock: 1 };

    expect((await collector.post('/marketplace/house/listings', body)).status).toBe(403);
    expect((await operator.post('/marketplace/house/listings', body)).status).toBe(403);
    expect((await collector.get('/marketplace/house/orders/queue')).status).toBe(403);
  });
});
