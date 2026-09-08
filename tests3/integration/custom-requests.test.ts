import { describe, it, expect } from 'vitest';
import { SEED, SEED_USERNAME, signIn, intakeFor } from '../../tests/integration/helpers/http';

/**
 * "Can you also…" — the request the service list has no button for.
 *
 * The vault offered nine services and every one was a fixed thing Bault had
 * decided to sell. A collector who wanted anything else — sleeve these before
 * you ship them, weigh this box, check the seal is intact — had exactly one
 * route: a support TICKET. A ticket is a conversation. It has no price, no
 * operator queue, no completion and no link to the collectible it is about, so
 * work agreed in a thread had to be re-entered by hand as something else, or it
 * quietly did not happen.
 *
 * The shape is `buyout`'s, because the same thing is true of both: nobody knows
 * what it costs until somebody reads it.
 */

const ASK = {
  summary: 'Sleeve before shipping',
  detail: 'Please put this in a penny sleeve and a toploader before it goes out.',
};

describe('asking for something that is not on the list', () => {
  it('costs nothing to ask', async () => {
    /**
     * Deliberate. A charge on the QUESTION would stop people asking, and the
     * questions are how Bault finds out which services it should be selling as
     * standard.
     */
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Custom: free to ask' });

    const before = (await owner.get('/finance/wallet')).body.amount as number;
    const created = await owner.post('/services/custom', { itemId: item.id, ...ASK });
    expect(created.status).toBe(201);
    expect(created.body.type).toBe('custom');
    expect((await owner.get('/finance/wallet')).body.amount).toBe(before);
  });

  it('refuses an ask nobody could price', async () => {
    const owner = await signIn(SEED.collector);
    const res = await owner.post('/services/custom', { summary: 'help', detail: 'pls' });
    expect(res.status).toBe(400);
  });

  it('allows two different asks about one collectible', async () => {
    // Two photo shoots on one card is a double charge for one job. "Sleeve this"
    // and "weigh this" are two pieces of work that share a type only because the
    // type means "not on the list".
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Custom: two asks' });

    expect((await owner.post('/services/custom', { itemId: item.id, ...ASK })).status).toBe(201);
    const second = await owner.post('/services/custom', {
      itemId: item.id,
      summary: 'Weigh it',
      detail: 'Can you weigh this and tell me the grams?',
    });
    expect(second.status).toBe(201);
  });

  it('refuses an ask about somebody else’s collectible', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Custom: not yours' });
    const stranger = await signIn(SEED.collector2);
    const res = await stranger.post('/services/custom', { itemId: item.id, ...ASK });
    expect(res.status).toBe(403);
  });
});

describe('the quote', () => {
  async function raised() {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Custom: quote flow' });
    const created = await owner.post('/services/custom', { itemId: item.id, ...ASK });
    await operator.post(`/services/requests/${created.body.id}/accept`, {});
    return { operator, owner, id: created.body.id as string };
  }

  const GOOD_QUOTE = { priceMinor: 25_00, scope: 'Penny sleeve plus toploader, fitted before packing.' };

  it('has to say what will actually be done, not just a number', async () => {
    /**
     * A collector accepting a figure is agreeing to whatever the operator
     * understood the ask to be. "We will do it for $30" with nothing behind it
     * is not something anybody can agree to — the same reason a buyout quote has
     * to carry its rationale.
     */
    const { operator, id } = await raised();
    const thin = await operator.post(`/services/custom/${id}/quote`, { priceMinor: 25_00, scope: 'ok' });
    expect(thin.status).toBe(400);

    expect((await operator.post(`/services/custom/${id}/quote`, GOOD_QUOTE)).status).toBe(201);
  });

  it('charges only when the collector accepts, and charges what was quoted', async () => {
    const { operator, owner, id } = await raised();
    await operator.post(`/services/custom/${id}/quote`, GOOD_QUOTE);

    // Quoting alone moves nothing.
    const quoted = (await owner.get('/finance/wallet')).body.amount as number;
    const accepted = await owner.post(`/services/custom/${id}/accept-quote`, {});
    expect(accepted.status).toBe(201);
    const after = (await owner.get('/finance/wallet')).body.amount as number;
    expect(quoted - after).toBe(GOOD_QUOTE.priceMinor);
  });

  it('bills the quoted figure, never one supplied by the caller', async () => {
    // The price is re-read from the request inside the transaction.
    const { operator, owner, id } = await raised();
    await operator.post(`/services/custom/${id}/quote`, GOOD_QUOTE);

    const before = (await owner.get('/finance/wallet')).body.amount as number;
    await owner.post(`/services/custom/${id}/accept-quote`, { priceMinor: 1 });
    const after = (await owner.get('/finance/wallet')).body.amount as number;
    expect(before - after).toBe(GOOD_QUOTE.priceMinor);
  });

  it('is the collector’s to accept and nobody else’s', async () => {
    const { operator, id } = await raised();
    await operator.post(`/services/custom/${id}/quote`, GOOD_QUOTE);
    const res = await operator.post(`/services/custom/${id}/accept-quote`, {});
    expect(res.status).toBe(404);
  });

  it('costs nothing to decline', async () => {
    const { operator, owner, id } = await raised();
    await operator.post(`/services/custom/${id}/quote`, GOOD_QUOTE);

    const before = (await owner.get('/finance/wallet')).body.amount as number;
    const declined = await owner.post(`/services/custom/${id}/decline-quote`, {});
    expect(declined.status).toBe(201);
    expect((await owner.get('/finance/wallet')).body.amount).toBe(before);
  });

  it('cannot be accepted before it exists', async () => {
    const { owner, id } = await raised();
    const res = await owner.post(`/services/custom/${id}/accept-quote`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/no quote/i);
  });

  it('says why when the answer is no', async () => {
    // A refusal with no reason leaves the collector guessing whether to ask
    // differently or stop asking.
    const { operator, id } = await raised();
    const bare = await operator.post(`/services/custom/${id}/decline`, { reason: 'no' });
    expect(bare.status).toBe(400);

    const declined = await operator.post(`/services/custom/${id}/decline`, {
      reason: 'We do not do framing — there is no workshop on site.',
    });
    expect(declined.status).toBe(201);
    expect(declined.body.status).toBe('cancelled');
    expect((declined.body.typeFields as { declineReason: string }).declineReason).toMatch(/workshop/);
  });
});

describe('doing the work', () => {
  it('refuses to complete something the collector never accepted', async () => {
    // Nobody can do unrequested work and then present it as complete.
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Custom: unaccepted' });
    const created = await owner.post('/services/custom', { itemId: item.id, ...ASK });
    await operator.post(`/services/requests/${created.body.id}/accept`, {});
    await operator.post(`/services/custom/${created.body.id}/quote`, {
      priceMinor: 25_00,
      scope: 'Penny sleeve plus toploader, fitted before packing.',
    });

    const res = await operator.post(`/services/custom/${created.body.id}/complete`, {
      notes: 'Done it anyway',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/not been accepted/i);
  });

  it('completes once it has been agreed and paid for', async () => {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Custom: full run' });
    const created = await owner.post('/services/custom', { itemId: item.id, ...ASK });
    await operator.post(`/services/requests/${created.body.id}/accept`, {});
    await operator.post(`/services/custom/${created.body.id}/quote`, {
      priceMinor: 25_00,
      scope: 'Penny sleeve plus toploader, fitted before packing.',
    });
    await owner.post(`/services/custom/${created.body.id}/accept-quote`, {});

    const done = await operator.post(`/services/custom/${created.body.id}/complete`, {
      notes: 'Sleeved and toploadered, packed for shipping.',
    });
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('completed');

    // It is an ordinary service request, so it appears where all of them do.
    const mine = (await owner.get('/services/mine')).body as { id: string; type: string }[];
    expect(mine.find((r) => r.id === created.body.id)?.type).toBe('custom');
  });

  it('shows up in the operator queue like any other request', async () => {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Custom: in the queue' });
    const created = await owner.post('/services/custom', { itemId: item.id, ...ASK });

    const queue = (await operator.get('/services/queue')).body as { id: string; type: string }[];
    expect(queue.some((r) => r.id === created.body.id && r.type === 'custom')).toBe(true);
  });
});

describe('booking a run of collectibles in at once', () => {
  it('gives every copy its own serial, barcode and charge', async () => {
    /**
     * `quantity` is not the lot box. A lot is ONE record standing for many
     * things, tracked and charged as one; a quantity is N separate records that
     * happen to have been typed once.
     */
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const before = (await owner.get('/finance/wallet')).body.amount as number;

    const res = await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      description: 'Bulk run of 12',
      autoStow: true,
      quantity: 12,
    });
    expect(res.status).toBe(201);

    const made = res.body as { serialNumber: string; barcode: string; isLot: boolean }[];
    expect(made).toHaveLength(12);
    expect(new Set(made.map((i) => i.serialNumber)).size).toBe(12);
    expect(new Set(made.map((i) => i.barcode)).size).toBe(12);
    expect(made.every((i) => !i.isLot)).toBe(true);

    // Twelve items, twelve intake charges — not one.
    const after = (await owner.get('/finance/wallet')).body.amount as number;
    expect(before - after).toBeGreaterThan(0);
    expect((before - after) % 12).toBe(0);
  });

  it('still treats a lot as the single thing it is', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      description: 'A sealed lot of 30',
      autoStow: true,
      isLot: true,
      lotSize: 30,
    });
    expect(res.status).toBe(201);
    expect(res.body.isLot).toBe(true);
    expect(res.body.lotSize).toBe(30);
    expect(res.body.serialNumber).toMatch(/^LOT-/);
  });
});
