import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from '../integration/helpers/http';

describe('concurrency: no double-sale', () => {
  it('exactly one of two concurrent purchases succeeds', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });

    const seller = await signIn(SEED.collector);
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 10000 });
    const listingId = listing.body.id as string;

    await fundWallet(SEED.collector2, 100000);
    await fundWallet(SEED.collector3, 100000);
    const buyerA = await signIn(SEED.collector2);
    const buyerB = await signIn(SEED.collector3);

    const [r1, r2] = await Promise.all([
      buyerA.post(`/marketplace/listings/${listingId}/purchase`),
      buyerB.post(`/marketplace/listings/${listingId}/purchase`),
    ]);

    const statuses = [r1.status, r2.status].sort();
    const successes = [r1, r2].filter((r) => r.status === 201);
    expect(successes).toHaveLength(1);
    expect(statuses.some((s) => s === 409 || s === 403)).toBe(true);
  });
});
