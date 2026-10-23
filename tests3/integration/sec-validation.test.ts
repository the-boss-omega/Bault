import { describe, it, expect } from 'vitest';
import { Client, SEED, signIn, intakeFor, fixtureEmail } from '../../tests/integration/helpers/http';
import { CURRENT_TERMS_VERSION } from '../../apps/api/src/modules/acc/terms';

describe('money amounts', () => {
  it('refuses a negative, zero or absurd cash-in amount', async () => {
    const collector = await signIn(SEED.collector);
    const amounts = [-1, -100_00, 0, 0.5, Number.MAX_SAFE_INTEGER];

    for (const amountMinor of amounts) {
      const res = await collector.post('/finance/wallet-requests', {
        type: 'cash_in',
        amountMinor,
        currency: 'USD',
        fundingSource: 'bank_transfer',
        reference: `bad-${amountMinor}-${Date.now()}`,
      });
      expect(res.status, `amountMinor ${amountMinor} was accepted`).toBeGreaterThanOrEqual(400);
      expect(res.status, `amountMinor ${amountMinor} caused a 5xx`).toBeLessThan(500);
    }
  });

  it('refuses a withdrawal larger than the balance', async () => {
    const collector = await signIn(SEED.collector);
    const wallet = await collector.get('/finance/wallet');
    const balance = wallet.body.amount as number;

    const res = await collector.post('/finance/withdrawals', {
      amountMinor: balance + 1_000_000_00,
      destinationAccount: 'IL62 0108 0000 0009 9999 999',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('refuses a listing priced at zero or below', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);

    for (const price of [0, -1, -50_00]) {
      const item = await intakeFor(operator, SEED.collector, { description: `Price ${price}` });
      const res = await collector.post('/marketplace/listings', {
        itemId: item.id,
        askingPrice: price,
      });
      expect(res.status, `price ${price} was accepted`).toBeGreaterThanOrEqual(400);
      expect(res.status, `price ${price} caused a 5xx`).toBeLessThan(500);
    }
  });

  it('refuses an offer of zero or a negative amount', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Offer target' });
    const listing = await collector.post('/marketplace/listings', {
      itemId: item.id,
      askingPrice: 100_00,
    });
    expect(listing.status).toBe(201);

    const buyer = await signIn(SEED.collector2);
    for (const amount of [0, -1]) {
      const res = await buyer.post(`/marketplace/listings/${listing.body.id}/offers`, { amount });
      expect(res.status, `offer ${amount} was accepted`).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('refuses a declared or insured value that is negative', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Negative values' });
    const address = await collector.post('/me/addresses', {
      label: 'Neg',
      recipient: 'Red Ashwood',
      line1: '12 Vine St',
      city: 'Trenton',
      region: 'NJ',
      country: 'US',
      postalCode: '08608',
    });

    const res = await collector.post('/shipping/shipments', {
      itemIds: [item.id],
      addressId: address.body.id,
      declaredValueMinor: -100,
      insuredValueMinor: -100,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('identifiers that do not exist or are the wrong shape', () => {
  const RUBBISH = ['not-a-uuid', '00000000-0000-0000-0000-000000000000', '1 OR 1=1', '../../etc/passwd'];

  it('answers 4xx, never 5xx, for a malformed or unknown id on every read route', async () => {
    const collector = await signIn(SEED.collector);
    const failures: string[] = [];

    for (const id of RUBBISH) {
      const paths = [
        `/vault/items/${encodeURIComponent(id)}`,
        `/vault/items/${encodeURIComponent(id)}/timeline`,
        `/vault/items/${encodeURIComponent(id)}/storage`,
        `/parcels/${encodeURIComponent(id)}`,
        `/shipping/shipments/${encodeURIComponent(id)}`,
        `/services/requests/${encodeURIComponent(id)}`,
        `/support/tickets/${encodeURIComponent(id)}`,
        `/escrow/${encodeURIComponent(id)}`,
        `/finance/wallet-requests/${encodeURIComponent(id)}`,
      ];
      for (const path of paths) {
        const res = await collector.get(path);
        if (res.status >= 500) failures.push(`${path} → ${res.status}`);
      }
    }

    expect(failures, `routes that 5xx'd on a bad id: ${failures.join(', ')}`).toEqual([]);
  });

  it('answers 4xx, never 5xx, for a malformed id on staff write routes', async () => {
    const operator = await signIn(SEED.operator);
    const failures: string[] = [];

    for (const id of RUBBISH) {
      const calls: [string, unknown][] = [
        [`/custody/items/${encodeURIComponent(id)}/relocate`, { binId: 'BIN-NOPE' }],
        [`/intake/items/${encodeURIComponent(id)}/break-lot`, {}],
        [`/parcels/${encodeURIComponent(id)}/open`, { condition: 'sound', conditionNotes: 'x' }],
        [`/parcels/${encodeURIComponent(id)}/process`, {}],
      ];
      for (const [path, body] of calls) {
        const res = await operator.post(path, body);
        if (res.status >= 500) failures.push(`${path} → ${res.status}`);
      }
    }

    expect(failures, `staff routes that 5xx'd on a bad id: ${failures.join(', ')}`).toEqual([]);
  });
});

describe('payload shape', () => {
  it('refuses unknown fields rather than silently ignoring them', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/intake/items', {
      ownerUsername: 'red',
      typeClass: 'trading_card',
      autoStow: true,
      totallyMadeUpField: 'ignored?',
    });
    expect(res.status).toBe(400);
  });

  it('refuses a wrong-typed field', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/intake/items', {
      ownerUsername: 12345,
      typeClass: ['trading_card'],
      autoStow: 'yes',
    });
    expect(res.status).toBe(400);
  });

  it('survives an oversized string without a 5xx', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/support/tickets', {
      category: 'other',
      subject: 'x'.repeat(10_000),
      body: 'y'.repeat(200_000),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('stores a script tag as text rather than executing or rejecting it oddly', async () => {
    const collector = await signIn(SEED.collector);
    const payload = '<script>alert("xss")</script>';
    const created = await collector.post('/support/tickets', {
      category: 'other',
      subject: payload,
      body: `body ${payload}`,
    });
    expect(created.status).toBe(201);

    const read = await collector.get(`/support/tickets/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.body)).toContain('script');
  });

  it('treats a SQL-shaped string as an ordinary value', async () => {
    const collector = await signIn(SEED.collector);
    const created = await collector.post('/support/tickets', {
      category: 'other',
      subject: "'; DROP TABLE item; --",
      body: "1' OR '1'='1",
    });
    expect(created.status).toBe(201);

    const operator = await signIn(SEED.operator);
    const report = await operator.get('/custody/report?cut=shelf');
    expect(report.status).toBe(200);
    expect(report.body.total).toBeGreaterThan(0);
  });
});

describe('registration and identity', () => {
  it('refuses a malformed email', async () => {
    const anon = new Client();
    for (const email of ['not-an-email', 'a@', '@b.com', 'a b@c.com']) {
      const res = await anon.post('/auth/register', {
        email,
        password: 'a-good-password-1',
        firstName: 'Test',
        lastName: 'Person',
        username: `u${Date.now()}`,
        acceptedTermsVersion: CURRENT_TERMS_VERSION,
      });
      expect(res.status, `${email} was accepted`).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('refuses a duplicate username', async () => {
    const anon = new Client();
    const res = await anon.post('/auth/register', {
      email: fixtureEmail('dupe'),
      password: 'a-good-password-1',
      firstName: 'Test',
      lastName: 'Person',
      username: 'red',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('refuses a trivially short password', async () => {
    const anon = new Client();
    const res = await anon.post('/auth/register', {
      email: fixtureEmail('weak'),
      password: '1',
      firstName: 'Test',
      lastName: 'Person',
      username: `weak${Date.now()}`,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('will not let an account change its username', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.patch('/me/profile', { username: 'somethingelse' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const me = await collector.get('/me/profile');
    expect(me.body.username).toBe('red');
  });
});

describe('quantity and size limits', () => {
  it('caps a bulk intake rather than accepting an unbounded quantity', async () => {
    const operator = await signIn(SEED.operator);
    for (const quantity of [0, -5, 1000, 1_000_000]) {
      const res = await operator.post('/intake/items', {
        ownerUsername: 'red',
        typeClass: 'trading_card',
        autoStow: true,
        quantity,
      });
      expect(res.status, `quantity ${quantity} was accepted`).toBeGreaterThanOrEqual(400);
      expect(res.status, `quantity ${quantity} caused a 5xx`).toBeLessThan(500);
    }
  });

  it('refuses a listing limit that is not a positive whole number, and caps a large one (N3)', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    for (let i = 0; i < 3; i += 1) {
      const card = await intakeFor(operator, SEED.collector, { description: `N3 listing ${i}` });
      await seller.post('/marketplace/listings', { itemId: card.id, askingPrice: 10_00 + i });
    }

    const guest = new Client();
    for (const limit of ['abc', '-1', '0', '1.5', '1e3', ' ']) {
      const res = await guest.get(`/marketplace/listings?limit=${encodeURIComponent(limit)}`);
      expect(res.status, `limit=${JSON.stringify(limit)} was accepted`).toBe(400);
    }

    const two = await guest.get('/marketplace/listings?limit=2');
    expect(two.status).toBe(200);
    expect((two.body as unknown[]).length).toBe(2);

    const huge = await guest.get('/marketplace/listings?limit=500');
    expect(huge.status).toBe(200);
    expect((huge.body as unknown[]).length).toBeLessThanOrEqual(200);

    expect((await guest.get('/marketplace/listings')).status).toBe(200);
  });

  it('refuses a shipment with no items at all', async () => {
    const collector = await signIn(SEED.collector);
    const address = await collector.post('/me/addresses', {
      label: 'Empty',
      recipient: 'Red Ashwood',
      line1: '12 Vine St',
      city: 'Trenton',
      region: 'NJ',
      country: 'US',
      postalCode: '08608',
    });
    const res = await collector.post('/shipping/shipments', {
      itemIds: [],
      addressId: address.body.id,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('refuses the same item twice in one shipment', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Duplicated' });
    const address = await collector.post('/me/addresses', {
      label: 'Dupe',
      recipient: 'Red Ashwood',
      line1: '12 Vine St',
      city: 'Trenton',
      region: 'NJ',
      country: 'US',
      postalCode: '08608',
    });
    const res = await collector.post('/shipping/shipments', {
      itemIds: [item.id, item.id],
      addressId: address.body.id,
    });
    if (res.status === 201) {
      expect(res.body.itemIds).toHaveLength(1);
    } else {
      expect(res.status).toBeLessThan(500);
    }
  });
});
