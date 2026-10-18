import { describe, it, expect } from 'vitest';
import { SEED, SEED_USERNAME, signIn, intakeFor } from '../../tests/integration/helpers/http';

const ASK = {
  summary: 'Sleeve before shipping',
  detail: 'Please put this in a penny sleeve and a toploader before it goes out.',
};

describe('asking for something that is not on the list', () => {
  it('costs nothing to ask', async () => {
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
    const { operator, id } = await raised();
    const thin = await operator.post(`/services/custom/${id}/quote`, { priceMinor: 25_00, scope: 'ok' });
    expect(thin.status).toBe(400);

    expect((await operator.post(`/services/custom/${id}/quote`, GOOD_QUOTE)).status).toBe(201);
  });

  it('charges only when the collector accepts, and charges what was quoted', async () => {
    const { operator, owner, id } = await raised();
    await operator.post(`/services/custom/${id}/quote`, GOOD_QUOTE);

    const quoted = (await owner.get('/finance/wallet')).body.amount as number;
    const accepted = await owner.post(`/services/custom/${id}/accept-quote`, {});
    expect(accepted.status).toBe(201);
    const after = (await owner.get('/finance/wallet')).body.amount as number;
    expect(quoted - after).toBe(GOOD_QUOTE.priceMinor);
  });

  it('bills the quoted figure, never one supplied by the caller', async () => {
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

describe('a quote that has been accepted', () => {
  const QUOTE = { priceMinor: 30_00, scope: 'Weigh it and photograph the seal before it ships.' };

  async function acceptedAndPaid() {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Custom: accepted quote' });
    const created = await owner.post('/services/custom', { itemId: item.id, ...ASK });
    const id = created.body.id as string;
    await operator.post(`/services/requests/${id}/accept`, {});
    expect((await operator.post(`/services/custom/${id}/quote`, QUOTE)).status).toBe(201);
    const before = (await owner.get('/finance/wallet')).body.amount as number;
    expect((await owner.post(`/services/custom/${id}/accept-quote`, {})).status).toBe(201);
    return { operator, owner, id, before };
  }

  it('cannot be quoted again, so it cannot be charged again', async () => {
    const { operator, owner, id, before } = await acceptedAndPaid();

    const again = await operator.post(`/services/custom/${id}/quote`, { ...QUOTE, priceMinor: 45_00 });
    expect(again.status).toBe(409);

    const secondAccept = await owner.post(`/services/custom/${id}/accept-quote`, {});
    expect(secondAccept.status).toBe(409);

    expect((await owner.get('/finance/wallet')).body.amount).toBe(before - QUOTE.priceMinor);
    const detail = (await owner.get(`/services/requests/${id}`)).body as { typeFields: Record<string, unknown> };
    expect(detail.typeFields.stage).toBe('accepted');
  });

  it('gives the money back when the work turns out to be impossible after all', async () => {
    const { operator, owner, id, before } = await acceptedAndPaid();

    const declined = await operator.post(`/services/custom/${id}/decline`, {
      reason: 'The seal is cracked — weighing it would break it open.',
    });
    expect(declined.status).toBe(201);
    expect(declined.body.status).toBe('cancelled');

    expect((await owner.get('/finance/wallet')).body.amount).toBe(before);
    const ledger = (await owner.get('/finance/ledger')).body as Array<{
      type: string;
      amount: number;
      direction: string;
      referenceId: string | null;
    }>;
    expect(
      ledger.some((r) => r.type === 'service_refund' && r.direction === 'credit' && r.amount === QUOTE.priceMinor && r.referenceId === id),
    ).toBe(true);

    expect((await operator.post(`/services/custom/${id}/decline`, { reason: 'Declining it twice.' })).status).toBe(409);
    expect((await owner.get('/finance/wallet')).body.amount).toBe(before);
  });
});

describe('a buyout the collector has accepted', () => {
  it('cannot be quoted again', async () => {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Buyout: accepted' });
    const requested = await owner.post('/services/buyout', { itemId: item.id });
    const id = requested.body.id as string;
    await operator.post(`/services/requests/${id}/accept`, {});
    const quote = { offerMinor: 40_00, rationale: 'Clean edges, light whitening.', itemVerified: true };
    expect((await operator.post(`/services/buyout/${id}/quote`, quote)).status).toBe(201);

    const before = (await owner.get('/finance/wallet')).body.amount as number;
    expect((await owner.post(`/services/buyout/${id}/accept`, {})).status).toBe(201);

    const again = await operator.post(`/services/buyout/${id}/quote`, { ...quote, offerMinor: 90_00 });
    expect(again.status).toBe(409);
    expect((await owner.post(`/services/buyout/${id}/accept`, {})).status).toBe(409);
    expect((await owner.get('/finance/wallet')).body.amount).toBe(before + quote.offerMinor);
  });
});
