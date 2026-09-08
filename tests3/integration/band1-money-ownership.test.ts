import { describe, it, expect } from 'vitest';
import { Client, SEED, signIn, intakeFor, fundWallet } from '../../tests/integration/helpers/http';

/**
 * Band 1 — money and ownership, as a person drives it.
 *
 * These pin the defects found by exercising the money actions by hand rather
 * than by reading them. Two of the three could not have been caught by a
 * happy-path test, because each one SUCCEEDED when it should not have.
 */

describe('an offer is the other side’s to accept', () => {
  /**
   * The serious one.
   *
   * `loadParticipating` allowed either side of a negotiation, and `accept` used
   * it with no further check — so a buyer could offer $40 on a $100 listing,
   * accept their own offer, and take the card at their own price with the seller
   * never consulted. Verified by doing it: the item moved.
   *
   * The FIRST fix for this said "only the seller may accept", which is right for
   * an opening offer and wrong for every counter — see
   * `band2-negotiation.test.ts`, which pins the rule that replaced it. These
   * cases still hold under that rule; only the wording of the refusal changed.
   */
  it('refuses to let the buyer accept their own offer', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 1: self-accept' });
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 100_00 });
    expect(listing.status).toBe(201);

    await fundWallet(SEED.collector2, 200_00);
    const buyer = await signIn(SEED.collector2);
    const offer = await buyer.post(`/marketplace/listings/${listing.body.id}/offers`, { amount: 40_00 });
    expect(offer.status).toBe(201);

    const selfAccept = await buyer.post(`/marketplace/offers/${offer.body.id}/respond`, {
      action: 'accept',
    });
    expect(selfAccept.status).toBe(403);
    expect(selfAccept.body.error.message).toMatch(/seller's to accept/i);

    // And the card is still the seller's.
    const stillMine = await seller.get('/vault/items');
    expect((stillMine.body as { id: string }[]).some((i) => i.id === item.id)).toBe(true);
  });

  it('lets the buyer revise their own offer, which is not the same as accepting it', async () => {
    /**
     * Countering your OWN offer is changing your mind about your own price, and
     * only one open offer per buyer per listing is allowed — so without this the
     * only way to raise a bid was to withdraw, find the listing again and start
     * over. What it must never do is conclude the sale, and it does not: the
     * revised offer is still the seller's to accept.
     */
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 1: revise' });
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 100_00 });

    const buyer = await signIn(SEED.collector2);
    const offer = await buyer.post(`/marketplace/listings/${listing.body.id}/offers`, { amount: 40_00 });
    const revised = await buyer.post(`/marketplace/offers/${offer.body.id}/respond`, {
      action: 'counter',
      amount: 50_00,
    });
    expect(revised.status).toBe(201);
    expect(revised.body.amount).toBe(50_00);

    // Still not theirs to accept.
    const selfAccept = await buyer.post(`/marketplace/offers/${revised.body.id}/respond`, {
      action: 'accept',
    });
    expect(selfAccept.status).toBe(403);

    // And the card has not moved.
    const stillMine = await seller.get('/vault/items');
    expect((stillMine.body as { id: string }[]).some((i) => i.id === item.id)).toBe(true);
  });

  it('lets the buyer withdraw, and says which side ended it', async () => {
    // Both sides may END a negotiation — refusing a buyer the ability to take
    // their own offer off the table would leave money committed against an offer
    // they no longer want honoured.
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 1: withdraw' });
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 100_00 });

    const buyer = await signIn(SEED.collector2);
    const offer = await buyer.post(`/marketplace/listings/${listing.body.id}/offers`, { amount: 40_00 });
    const res = await buyer.post(`/marketplace/offers/${offer.body.id}/respond`, { action: 'reject' });
    expect(res.status).toBe(201);
    expect(res.body.by).toBe('buyer');
  });

  it('lets the seller accept, which is the whole point', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 1: seller accepts' });
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 100_00 });

    await fundWallet(SEED.collector2, 200_00);
    const buyer = await signIn(SEED.collector2);
    const offer = await buyer.post(`/marketplace/listings/${listing.body.id}/offers`, { amount: 45_00 });

    const accepted = await seller.post(`/marketplace/offers/${offer.body.id}/respond`, {
      action: 'accept',
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.price).toBe(45_00);

    const theirs = await buyer.get('/vault/items');
    expect((theirs.body as { id: string }[]).some((i) => i.id === item.id)).toBe(true);
  });
});

describe('a validation failure says which field and why', () => {
  /**
   * Every field-validation failure in the product answered with the literal
   * string "Bad Request Exception" — Nest's internal class name — on all 164
   * routes. The detail existed and was being discarded.
   */
  it('names the fields rather than the exception class', async () => {
    const anon = new Client();
    const res = await anon.post('/auth/login', {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).not.toMatch(/Bad Request Exception/);
    // The MESSAGE is written for a person, so it says the fields in words and
    // says what is wrong with them rather than only listing them.
    expect(res.body.error.message).toMatch(/identifier/i);
    expect(res.body.error.message).toMatch(/password/i);
    expect(res.body.error.message).toMatch(/required/i);
    // The VIOLATIONS keep the property names, which is what a form marks up.
    const fields = (res.body.error.details.violations as { field: string }[]).map((v) => v.field);
    expect(fields).toContain('identifier');
    expect(fields).toContain('password');
  });

  it('carries per-field violations a form can mark up', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/finance/checkout', { amountMinor: 5000, route: 'card' });
    expect(res.status).toBe(400);

    const violations = res.body.error.details.violations as {
      field: string;
      code: string;
      message: string;
    }[];
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.field === 'idempotencyKey')).toBe(true);
    for (const v of violations) {
      expect(v.code).toBeTruthy();
      expect(v.message).toBeTruthy();
    }
  });

  it('states a single failure as a sentence, in the words the form uses', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/finance/withdrawals', { amountMinor: 5000 });
    expect(res.status).toBe(400);
    /**
     * `destinationAccount` is a property name, and "destinationAccount must be a
     * string" is what a validator library says about a value nobody sent. The
     * reader is told the name of the thing and what to do about it; the property
     * name stays in `violations` where a client can use it.
     */
    expect(res.body.error.message).toBe('destination account is required.');
    expect(res.body.error.message).not.toMatch(/must be a string/);
    expect((res.body.error.details.violations as { field: string }[])[0]!.field).toBe(
      'destinationAccount',
    );
  });

  it('reports a nested field by its path', async () => {
    const operator = await signIn(SEED.operator);
    const batch = await operator.post('/intake/batches', { ownerUsername: 'red' });
    const res = await operator.post(`/intake/batches/${batch.body.id}/split`, {
      items: [{ typeClass: 123 }],
    });
    expect(res.status).toBe(400);
    const violations = res.body.error.details.violations as { field: string }[];
    // `items.0.typeClass`, not a bare `typeClass` that names nothing findable.
    expect(violations.some((v) => v.field.includes('items.0'))).toBe(true);
  });
});

describe('buying the same thing twice', () => {
  it('charges once and says the second was a replay', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 1: replay' });
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 30_00 });

    await fundWallet(SEED.collector2, 100_00);
    const buyer = await signIn(SEED.collector2);

    const before = (await buyer.get('/finance/wallet')).body.amount as number;
    const first = await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`, {});
    const mid = (await buyer.get('/finance/wallet')).body.amount as number;
    const second = await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`, {});
    const after = (await buyer.get('/finance/wallet')).body.amount as number;

    expect(before - mid).toBe(30_00);
    expect(after).toBe(mid); // charged once, not twice

    // The first is a purchase; the second says it is not, so the UI can stop
    // announcing "Purchased" for a button that was double-clicked.
    expect(first.body.replayed).toBeUndefined();
    expect(second.body.replayed).toBe(true);
    expect(second.body.transactionId).toBe(first.body.transactionId);
  });
});

describe('what cancelling a shipment will cost is published', () => {
  it('names the restocking fee before anybody has to accept it', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/shipping/services');
    expect(res.status).toBe(200);
    // The warning in the UI reads "Cancelling now charges a {amount} restocking
    // fee". Without this figure it could only say "a fee".
    expect(res.body.restockingFeeMinor).toBeGreaterThan(0);
  });
});
