import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from '../integration/helpers/http';
import { closeDb, holdRowLock, sql, waitForLockWaiters } from '../integration/helpers/db';

afterAll(async () => {
  await closeDb();
});

describe('concurrency: a counter-offer racing a sale', () => {
  it('leaves no pending offer on a listing that sold while the counter was being written', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card', description: 'Countered as it sells' });
    const seller = await signIn(SEED.collector);
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 30000 });
    expect(listing.status, JSON.stringify(listing.body)).toBe(201);
    const listingId = listing.body.id as string;

    await fundWallet(SEED.collector2, 30000);
    await fundWallet(SEED.collector3, 40000);
    const bidder = await signIn(SEED.collector2);
    const buyer = await signIn(SEED.collector3);
    const offer = await bidder.post(`/marketplace/listings/${listingId}/offers`, { amount: 20000 });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);

    const lock = await holdRowLock('offer', offer.body.id as string);
    let countered: ReturnType<typeof seller.post> | undefined;
    let bought: ReturnType<typeof buyer.post> | undefined;
    try {
      countered = seller.post(`/marketplace/offers/${offer.body.id}/respond`, { action: 'counter', amount: 25000 });
      await waitForLockWaiters(1);
      bought = buyer.post(`/marketplace/listings/${listingId}/purchase`);
      await waitForLockWaiters(2);
    } finally {
      await lock.release();
    }
    const [c, b] = await Promise.all([countered!, bought!]);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect([201, 409], JSON.stringify(c.body)).toContain(c.status);

    const pending = await sql<{ id: string }>(`SELECT id FROM offer WHERE listing_id = $1 AND status = 'pending'`, [listingId]);
    expect(pending).toEqual([]);
  }, 30_000);
});
