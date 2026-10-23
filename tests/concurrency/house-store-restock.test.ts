import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, signIn, type Client } from '../integration/helpers/http';
import { closeDb, holdRowLock, waitForLockWaiters } from '../integration/helpers/db';

type Res = Awaited<ReturnType<Client['post']>>;
const ok = (r: Res) => r.status >= 200 && r.status < 300;
const PRICE = 1_000;

afterAll(closeDb);

async function product(admin: Client, label: string, stock: number) {
  const res = await admin.post('/marketplace/house/listings', {
    typeClass: 'trading_card',
    description: `Restock race: ${label}`,
    conditionGrade: 'Raw',
    photoRef: 'SN-RESTOCK',
    askingPrice: PRICE,
    stock,
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const stockOf = async (admin: Client, id: string) =>
  ((await admin.get('/marketplace/house/manage')).body as { id: string; stock: number }[]).find((p) => p.id === id)!.stock;

describe('concurrency: restocking the store', () => {
  it('does not undo the sales that commit while a restock waits for the row', async () => {
    const admin = await signIn(SEED.admin);
    const buyer = await signIn(SEED.collector2);
    const SALES = 3;
    await fundWallet(SEED.collector2, PRICE * (SALES + 1));
    const id = await product(admin, 'sales queued ahead of the save', 5);
    const seen = await stockOf(admin, id);
    expect(seen).toBe(5);

    const lock = await holdRowLock('house_listing', id);
    let purchases: Promise<Res>[] = [];
    let saves: Promise<Res>[] = [];
    try {
      purchases = Array.from({ length: SALES }, () => buyer.post(`/marketplace/house/listings/${id}/purchase`));
      await waitForLockWaiters(SALES);
      saves = [
        admin.patch(`/marketplace/house/listings/${id}`, { stock: 10 }),
        admin.patch(`/marketplace/house/listings/${id}`, { stock: 10, expectedStock: seen }),
      ];
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      await lock.release();
    }
    const sold = (await Promise.all(purchases)).filter(ok).length;
    const [bare, named] = await Promise.all(saves);
    expect(sold).toBe(SALES);

    const applied = named!.status === 200;
    expect(await stockOf(admin, id)).toBe((applied ? 10 : seen) - SALES);
    expect(bare!.status).toBe(400);
    if (!applied) {
      expect(named!.status).toBe(409);
      const stood = (named!.body.error.details as { stock: number }).stock;
      expect(stood).toBeGreaterThanOrEqual(seen - SALES);
      expect(stood).toBeLessThan(seen);
    }
  });

  it('applies a restock made against the figure as it stands', async () => {
    const admin = await signIn(SEED.admin);
    const buyer = await signIn(SEED.collector2);
    await fundWallet(SEED.collector2, PRICE * 2);
    const id = await product(admin, 'sale before save', 5);

    const seen = await stockOf(admin, id);
    expect((await buyer.post(`/marketplace/house/listings/${id}/purchase`)).status).toBe(201);
    expect((await admin.patch(`/marketplace/house/listings/${id}`, { stock: 10, expectedStock: seen })).status).toBe(409);

    const again = await admin.patch(`/marketplace/house/listings/${id}`, { stock: 9, expectedStock: 4 });
    expect(again.status).toBe(200);
    expect(again.body.stock).toBe(9);
    expect(await stockOf(admin, id)).toBe(9);

    expect((await admin.patch(`/marketplace/house/listings/${id}`, { askingPrice: 1_200 })).status).toBe(200);
    expect((await admin.patch(`/marketplace/house/listings/${id}`, { status: 'removed' })).status).toBe(200);
    expect(await stockOf(admin, id)).toBe(9);
  });
});
