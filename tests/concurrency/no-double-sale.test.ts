import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from '../integration/helpers/http';

/**
 * Two buyers purchase the SAME listing simultaneously: exactly one succeeds, the
 * other gets 409/403 (Principles V & VIII). The `SELECT … FOR UPDATE` row lock in
 * PurchaseService serializes them, making a double-sale impossible. Requires a
 * running API + seeded DB.
 */
describe('concurrency: no double-sale', () => {
  it('exactly one of two concurrent purchases succeeds', async () => {
    // Seller = the first collector; the operator intakes an item for them.
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });

    const seller = await signIn(SEED.collector);
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 10000 });
    const listingId = listing.body.id as string;

    // Two distinct funded buyers, both != seller. Funding goes through the
    // cash-in approval path, and neither buyer is the admin because an admin may
    // not approve their own wallet request.
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
    // The loser is a conflict/forbidden, never a second 201.
    expect(statuses.some((s) => s === 409 || s === 403)).toBe(true);
  });
});
