import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from './helpers/http';

/**
 * Offers: submit → accept triggers purchase at the offer price; own-listing
 * offer blocked. Submitting an offer also notifies the seller (Req 6.2).
 *
 * The buyer here is `collector3`, NOT `collector2`, deliberately: mkt-purchase
 * asserts an exact debit on collector2's wallet, and two suites moving one
 * wallet produce a failure that looks like a double debit and is really two
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

  /**
   * An offer on a listing that is no longer for sale can never be accepted,
   * so leaving it `pending` tells the bidder their money is still promised to
   * a card somebody else now owns, and shows the seller an offer to answer on
   * a card that is gone. It is closed with the sale, in the same transaction.
   */
  async function listedWithOffer(label: string) {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card', description: label });
    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 30000 })).body;
    const bidder = await signIn(SEED.collector2);
    await fundWallet(SEED.collector2, 20000);
    const offer = await bidder.post(`/marketplace/listings/${listing.id}/offers`, { amount: 15000 });
    expect(offer.status).toBe(201);
    return { seller, bidder, listingId: listing.id as string, offerId: offer.body.id as string };
  }

  const statusOf = async (c: Awaited<ReturnType<typeof signIn>>, offerId: string) =>
    ((await c.get('/marketplace/offers/mine')).body as { id: string; status: string }[]).find((o) => o.id === offerId)?.status;

  it('closes the other open offers when the listing is bought outright', async () => {
    const { seller, bidder, listingId, offerId } = await listedWithOffer('Offers closed by a purchase');
    const buyer = await signIn(SEED.collector3);
    await fundWallet(SEED.collector3, 30000);
    expect((await buyer.post(`/marketplace/listings/${listingId}/purchase`)).status).toBe(201);

    expect(await statusOf(bidder, offerId)).toBe('rejected');
    const mine = (await seller.get('/marketplace/listings/mine')).body as { id: string; pendingOffers: number }[];
    expect(mine.find((l) => l.id === listingId)?.pendingOffers).toBe(0);
  });

  it('closes the other open offers when one of them is accepted', async () => {
    const { seller, bidder, listingId, offerId } = await listedWithOffer('Offers closed by an acceptance');
    const winner = await signIn(SEED.collector3);
    await fundWallet(SEED.collector3, 20000);
    const winning = (await winner.post(`/marketplace/listings/${listingId}/offers`, { amount: 20000 })).body;

    expect((await seller.post(`/marketplace/offers/${winning.id}/respond`, { action: 'accept' })).status).toBe(201);
    expect(await statusOf(winner, winning.id)).toBe('accepted');
    expect(await statusOf(bidder, offerId)).toBe('rejected');
  });

  it('closes the open offers when the seller takes the listing down', async () => {
    const { seller, bidder, listingId, offerId } = await listedWithOffer('Offers closed by a removal');
    const challenge = (await seller.post(`/marketplace/listings/${listingId}/remove`)).body;
    expect((await seller.post('/marketplace/listings/remove/confirm', { confirmationToken: challenge.confirmationToken })).status).toBe(201);
    expect(await statusOf(bidder, offerId)).toBe('rejected');
  });
});
