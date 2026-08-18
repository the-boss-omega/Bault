import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from './helpers/http';

/**
 * US5 — offers: submit → accept triggers purchase at the offer price; own-listing
 * offer blocked (T082). Submitting an offer also notifies the seller (Req 6.2).
 *
 * The buyer here is `collector3`, NOT `collector2`, deliberately: mkt-purchase
 * asserts an exact debit on collector2's wallet, and two suites moving one
 * wallet produced a failure that looked like a double debit and was really two
 * tests sharing an account. Each money-asserting suite owns its own buyer.
 */
describe('MKT offers', () => {
  it('accepts an offer, executing a purchase at the offer price', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 30000 })).body;

    const buyer = await signIn(SEED.collector3);
    await fundWallet(SEED.collector3, 50000);
    const offer = (await buyer.post(`/marketplace/listings/${listing.id}/offers`, { amount: 20000 })).body;

    // Seller accepts → purchase at 20000 (the offer), not 30000 (the asking).
    const res = await seller.post(`/marketplace/offers/${offer.id}/respond`, { action: 'accept' });
    expect(res.status).toBe(201);
    expect(res.body.price).toBe(20000);
  });

  it('accepts an offer submission that will notify the seller (Requirement 6.2)', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 30000 })).body;

    const buyer = await signIn(SEED.collector3);
    const offer = await buyer.post(`/marketplace/listings/${listing.id}/offers`, { amount: 15000 });
    expect(offer.status).toBe(201);
    expect(offer.body.status).toBe('pending');
    // The `offer_received` event is emitted in the SAME transaction as the offer
    // (transactional outbox); the worker's dispatch turns it into the seller's
    // notification. Delivery + wording are asserted in not-notifications.test.ts.
  });

  it('blocks offering on your own listing', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 30000 })).body;

    const res = await seller.post(`/marketplace/listings/${listing.id}/offers`, { amount: 10000 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('self_dealing_forbidden');
  });
});
