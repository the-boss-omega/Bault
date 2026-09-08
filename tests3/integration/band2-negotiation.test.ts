import { describe, it, expect } from 'vitest';
import { SEED, signIn, intakeFor, fundWallet } from '../../tests/integration/helpers/http';

/**
 * A negotiation, driven from both sides.
 *
 * The rule these pin is not "the seller decides". It is:
 *
 *   THE PARTY WHO PROPOSED A PRICE MAY NOT ALSO ACCEPT IT.
 *
 * The first attempt at closing the self-accept hole said "only the seller may
 * accept", which is the same rule ONLY for an opening offer. On a counter it
 * failed in both directions at once, and both were reproduced against the
 * running API before being fixed:
 *
 *   - a seller countered at $80 and the BUYER could not accept it (403), so a
 *     counter-offer could never conclude a sale — the only exit from a
 *     negotiation was to walk away;
 *   - the SELLER could accept their own counter, and it EXECUTED: $80 taken from
 *     the buyer's wallet and the card moved, with the buyer never having agreed
 *     to that price.
 */

async function listing(description: string, askingPrice: number) {
  const operator = await signIn(SEED.operator);
  const seller = await signIn(SEED.collector);
  const item = await intakeFor(operator, SEED.collector, { description });
  const created = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice });
  return { seller, item, listing: created.body as { id: string } };
}

describe('a counter-offer can be concluded by the side it was sent to', () => {
  it('lets the buyer accept the seller’s counter', async () => {
    const { seller, item, listing: l } = await listing('Band 2: buyer accepts counter', 100_00);
    await fundWallet(SEED.collector2, 300_00);
    const buyer = await signIn(SEED.collector2);

    const opening = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 60_00 });
    const counter = await seller.post(`/marketplace/offers/${opening.body.id}/respond`, {
      action: 'counter',
      amount: 80_00,
    });
    expect(counter.status).toBe(201);

    const accepted = await buyer.post(`/marketplace/offers/${counter.body.id}/respond`, {
      action: 'accept',
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.price).toBe(80_00);

    const theirs = await buyer.get('/vault/items');
    expect((theirs.body as { id: string }[]).some((i) => i.id === item.id)).toBe(true);
  });

  it('refuses to let the seller accept their own counter', async () => {
    // The hole the first fix moved rather than closed. This one MOVED A CARD.
    const { seller, item, listing: l } = await listing('Band 2: seller self-accepts counter', 100_00);
    await fundWallet(SEED.collector2, 300_00);
    const buyer = await signIn(SEED.collector2);

    const opening = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 60_00 });
    const counter = await seller.post(`/marketplace/offers/${opening.body.id}/respond`, {
      action: 'counter',
      amount: 80_00,
    });

    const selfAccept = await seller.post(`/marketplace/offers/${counter.body.id}/respond`, {
      action: 'accept',
    });
    expect(selfAccept.status).toBe(403);
    expect(selfAccept.body.error.message).toMatch(/buyer's to accept/i);

    // Nothing was charged and nothing moved.
    const theirs = await buyer.get('/vault/items');
    expect((theirs.body as { id: string }[]).some((i) => i.id === item.id)).toBe(false);
  });

  it('lets the buyer counter back, and the seller close it', async () => {
    const { seller, item, listing: l } = await listing('Band 2: counter both ways', 100_00);
    await fundWallet(SEED.collector2, 300_00);
    const buyer = await signIn(SEED.collector2);

    const opening = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 60_00 });
    const fromSeller = await seller.post(`/marketplace/offers/${opening.body.id}/respond`, {
      action: 'counter',
      amount: 90_00,
    });
    const fromBuyer = await buyer.post(`/marketplace/offers/${fromSeller.body.id}/respond`, {
      action: 'counter',
      amount: 70_00,
    });
    expect(fromBuyer.status).toBe(201);

    // The buyer named this one, so it is not theirs to accept…
    const buyerAccept = await buyer.post(`/marketplace/offers/${fromBuyer.body.id}/respond`, {
      action: 'accept',
    });
    expect(buyerAccept.status).toBe(403);

    // …and the seller closes it.
    const done = await seller.post(`/marketplace/offers/${fromBuyer.body.id}/respond`, { action: 'accept' });
    expect(done.status).toBe(201);
    expect(done.body.price).toBe(70_00);
    const theirs = await buyer.get('/vault/items');
    expect((theirs.body as { id: string }[]).some((i) => i.id === item.id)).toBe(true);
  });

  it('says a superseded offer was countered, rather than "not pending"', async () => {
    const { seller, listing: l } = await listing('Band 2: stale parent', 100_00);
    const buyer = await signIn(SEED.collector2);
    const opening = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 60_00 });
    await seller.post(`/marketplace/offers/${opening.body.id}/respond`, { action: 'counter', amount: 80_00 });

    const stale = await seller.post(`/marketplace/offers/${opening.body.id}/respond`, { action: 'accept' });
    expect(stale.status).toBe(409);
    // "Offer is not pending" is a status column read aloud; a countered offer did
    // not end, it moved, and the reader has to be pointed at where it moved to.
    expect(stale.body.error.message).toMatch(/counter-offer/i);
  });
});

describe('an offer is a commitment, so it is checked when it is made', () => {
  it('refuses an offer the buyer cannot cover, naming their balance', async () => {
    /**
     * This used to be checked only at ACCEPT, which put the failure on the wrong
     * person entirely: the seller pressed Accept and was told "Insufficient
     * wallet balance" — an error about somebody else's money, phrased as if it
     * were their own.
     */
    const { listing: l } = await listing('Band 2: cannot cover', 500_000_00);
    const buyer = await signIn(SEED.collector2);
    const balance = (await buyer.get('/finance/wallet')).body.amount as number;

    const res = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: balance + 100_00 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('insufficient_balance');
    expect(res.body.error.message).toMatch(/commits you to pay/i);
  });

  it('leaves the offer open, not "accepted", when the acceptance cannot go through', async () => {
    /**
     * The status write happened BEFORE the purchase and outside its transaction,
     * so a failed acceptance left the offer marked `accepted` with no sale behind
     * it: the card never moved, the listing stayed live, and neither party could
     * touch the offer again because it was no longer pending. A dead record that
     * read as a completed deal.
     */
    const { seller, listing: l } = await listing('Band 2: acceptance fails', 300_00);
    await fundWallet(SEED.collector2, 200_00);
    const buyer = await signIn(SEED.collector2);
    // Affordable when offered — the balance is drained afterwards.
    const offer = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 150_00 });
    expect(offer.status).toBe(201);

    // Drain the buyer between offering and the seller answering.
    await buyer.post('/finance/withdrawals', {
      amountMinor: (await buyer.get('/finance/wallet')).body.amount,
      destinationAccount: 'IL62 0108 0000 0009 9999 999',
    });

    const attempt = await seller.post(`/marketplace/offers/${offer.body.id}/respond`, { action: 'accept' });
    if (attempt.status === 409) {
      // The seller is told whose problem it is.
      expect(attempt.body.error.message).toMatch(/buyer/i);
      const mine = (await buyer.get('/marketplace/offers/mine')).body as { id: string; status: string }[];
      expect(mine.find((o) => o.id === offer.body.id)?.status).toBe('pending');
    }
  });
});

describe('one open offer per buyer per listing', () => {
  it('refuses a second, naming the amount already on the table', async () => {
    // Six pending offers from one person on one card is not a negotiation, it is
    // a queue nobody asked for — and every one of them is independently
    // acceptable by a seller who can only see a wall of prices.
    const { listing: l } = await listing('Band 2: one open offer', 100_00);
    await fundWallet(SEED.collector2, 300_00);
    const buyer = await signIn(SEED.collector2);

    const first = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 50_00 });
    expect(first.status).toBe(201);

    const second = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 51_00 });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/\$50\.00/);

    // Withdrawing frees the slot.
    await buyer.post(`/marketplace/offers/${first.body.id}/respond`, { action: 'reject' });
    const third = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 51_00 });
    expect(third.status).toBe(201);
  });

  it('refuses an offer above the asking price rather than taking the money', async () => {
    const { listing: l } = await listing('Band 2: above asking', 75_00);
    await fundWallet(SEED.collector2, 300_00);
    const buyer = await signIn(SEED.collector2);
    const res = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 9_999_00 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/\$75\.00/);
    expect(res.body.error.message).toMatch(/buy it now/i);
  });
});

describe('the offers list says whose move it is', () => {
  it('reports side, proposer and turn on every row', async () => {
    /**
     * The panel keyed its controls off `direction` — which side of the LISTING
     * you are on — and so showed a buyer "waiting on the seller" with no controls
     * at all, even when the seller's counter was sitting in front of them.
     */
    const { seller, listing: l } = await listing('Band 2: whose turn', 100_00);
    const buyer = await signIn(SEED.collector2);
    const opening = await buyer.post(`/marketplace/listings/${l.id}/offers`, { amount: 60_00 });

    const buyerRows = (await buyer.get('/marketplace/offers/mine')).body as Record<string, unknown>[];
    const asBuyer = buyerRows.find((r) => r.id === opening.body.id)!;
    expect(asBuyer.side).toBe('buyer');
    expect(asBuyer.proposedBy).toBe('buyer');
    expect(asBuyer.yourTurn).toBe(false);

    const sellerRows = (await seller.get('/marketplace/offers/mine')).body as Record<string, unknown>[];
    const asSeller = sellerRows.find((r) => r.id === opening.body.id)!;
    expect(asSeller.side).toBe('seller');
    expect(asSeller.yourTurn).toBe(true);

    // After the counter the turn flips.
    const counter = await seller.post(`/marketplace/offers/${opening.body.id}/respond`, {
      action: 'counter',
      amount: 80_00,
    });
    const after = (await buyer.get('/marketplace/offers/mine')).body as Record<string, unknown>[];
    const countered = after.find((r) => r.id === counter.body.id)!;
    expect(countered.proposedBy).toBe('seller');
    expect(countered.yourTurn).toBe(true);
  });
});
