import { afterAll, describe, it, expect } from 'vitest';
import { Client, SEED, signIn, intakeFor } from '../../tests/integration/helpers/http';
import { closeDb, sql } from '../../tests/integration/helpers/db';

afterAll(closeDb);

const STAFF_ONLY: readonly [string, string][] = [
  ['GET', '/custody/bins'],
  ['GET', '/custody/bins/suggest'],
  ['GET', '/custody/bins/stowable'],
  ['POST', '/custody/bins'],
  ['GET', '/custody/report?cut=shelf'],
  ['POST', '/custody/reconcile'],
  ['POST', '/intake/items'],
  ['GET', '/intake/lots'],
  ['POST', '/intake/batches'],
  ['GET', '/intake/disposals'],
  ['POST', '/intake/disposals'],
  ['GET', '/parcels'],
  ['POST', '/parcels/receive'],
  ['GET', '/services/queue'],
  ['GET', '/services/grading/submissions'],
  ['POST', '/services/grading/submissions'],
  ['GET', '/support/queue'],
  ['GET', '/support/queue/count'],
  ['GET', '/escrow/queue'],
  ['GET', '/marketplace/house/orders/queue'],
];

const ADMIN_ONLY: readonly [string, string][] = [
  ['GET', '/admin/users'],
  ['GET', '/admin/items'],
  ['GET', '/admin/disputes'],
  ['GET', '/admin/transactions'],
  ['GET', '/admin/storage-fee-runs'],
  ['GET', '/admin/wallet-requests'],
  ['GET', '/admin/facilities'],
  ['POST', '/admin/facilities'],
  ['POST', '/pricing/rules'],
  ['GET', '/finance/chargebacks/reversible'],
  ['GET', '/marketplace/house/manage'],
  ['POST', '/marketplace/house/listings'],
];

const PUBLIC_ROUTES: readonly string[] = [
  '/content/shows',
  '/content/contact',
  '/content/locations',
  '/content/intake-policy',
  '/pricing/list',
  '/marketplace/listings',
  '/marketplace/house/listings',
  '/shipping/destinations/AU',
];

const OWNER_SCOPED: readonly string[] = [
  '/me/profile',
  '/me/addresses',
  '/me/parcels',
  '/me/disposals',
  '/me/inbound-addresses',
  '/vault/items',
  '/vault/counts',
  '/finance/wallet',
  '/finance/ledger',
  '/finance/payments',
  '/finance/wallet-requests',
  '/services/mine',
  '/support/tickets',
  '/escrow/mine',
  '/shipping/shipments',
  '/notifications',
];

async function call(client: Client, method: string, path: string) {
  if (method === 'GET') return client.get(path);
  if (method === 'POST') return client.post(path, {});
  if (method === 'PATCH') return client.patch(path, {});
  return client.del(path);
}

describe('anonymous access', () => {
  it('refuses every non-public route with 401, never 404 or 500', async () => {
    const anon = new Client();
    const failures: string[] = [];

    for (const [method, path] of [...STAFF_ONLY, ...ADMIN_ONLY]) {
      const res = await call(anon, method, path);
      if (res.status !== 401) failures.push(`${method} ${path} → ${res.status}`);
    }
    for (const path of OWNER_SCOPED) {
      const res = await anon.get(path);
      if (res.status !== 401) failures.push(`GET ${path} → ${res.status}`);
    }

    expect(failures, `unauthenticated calls that did not return 401: ${failures.join(', ')}`).toEqual(
      [],
    );
  });

  it('serves every route that is meant to be public', async () => {
    const anon = new Client();
    const failures: string[] = [];
    for (const path of PUBLIC_ROUTES) {
      const res = await anon.get(path);
      if (res.status !== 200) failures.push(`${path} → ${res.status}`);
    }
    expect(failures, `public routes that did not answer: ${failures.join(', ')}`).toEqual([]);
  });

  it('does not leak whether an email exists when a password reset is requested', async () => {
    const anon = new Client();
    const known = await anon.post('/auth/password/reset-request', { email: SEED.collector });
    const unknown = await anon.post('/auth/password/reset-request', {
      email: 'definitely-not-here@fixture.bault.test',
    });
    expect(unknown.status).toBe(known.status);
  });

  it('hands the reset mail to the outbox and answers every address the same way (N11)', async () => {
    const anon = new Client();
    const unknownEmail = `reset-n11-${Date.now()}@fixture.bault.test`;
    const known = await anon.post('/auth/password/reset-request', { email: SEED.collector });
    const unknown = await anon.post('/auth/password/reset-request', { email: unknownEmail });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);

    const queued = await sql<{ email: string }>(
      `SELECT payload->>'email' AS email FROM outbox_message
        WHERE event_type = 'password_reset_requested' AND payload->>'email' = ANY($1::text[])`,
      [[SEED.collector, unknownEmail]],
    );
    const addresses = new Set(queued.map((r) => r.email));
    expect(addresses.has(SEED.collector)).toBe(true);
    expect(addresses.has(unknownEmail)).toBe(true);

    const payloads = await sql<{ payload: string }>(
      `SELECT payload::text AS payload FROM outbox_message WHERE event_type = 'password_reset_requested'`,
    );
    expect(payloads.some((r) => /token|reset-password/.test(r.payload))).toBe(false);
  });

  it('refuses a login with the right identifier and a wrong password', async () => {
    const anon = new Client();
    const res = await anon.post('/auth/login', { identifier: 'red', password: 'wrong-password' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('a customer against staff routes', () => {
  it('is refused from every warehouse route with 403', async () => {
    const collector = await signIn(SEED.collector);
    const failures: string[] = [];
    for (const [method, path] of STAFF_ONLY) {
      const res = await call(collector, method, path);
      if (res.status !== 403) failures.push(`${method} ${path} → ${res.status}`);
    }
    expect(failures, `customer reached a staff route: ${failures.join(', ')}`).toEqual([]);
  });

  it('is refused from every admin route with 403', async () => {
    const collector = await signIn(SEED.collector);
    const failures: string[] = [];
    for (const [method, path] of ADMIN_ONLY) {
      const res = await call(collector, method, path);
      if (res.status !== 403) failures.push(`${method} ${path} → ${res.status}`);
    }
    expect(failures, `customer reached an admin route: ${failures.join(', ')}`).toEqual([]);
  });
});

describe('a warehouse operator against admin routes', () => {
  it('is refused from admin-only routes with 403', async () => {
    const operator = await signIn(SEED.operator);
    const failures: string[] = [];
    for (const [method, path] of ADMIN_ONLY) {
      const res = await call(operator, method, path);
      if (res.status !== 403) failures.push(`${method} ${path} → ${res.status}`);
    }
    expect(failures, `operator reached an admin route: ${failures.join(', ')}`).toEqual([]);
  });

  it('can still reach the warehouse routes it is meant to', async () => {
    const operator = await signIn(SEED.operator);
    for (const path of ['/custody/bins', '/parcels', '/services/queue', '/support/queue']) {
      const res = await operator.get(path);
      expect(res.status, `operator blocked from ${path}`).toBe(200);
    }
  });
});

describe('one customer against another customer', () => {
  it('cannot read an item it does not own', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Red owns this' });

    const other = await signIn(SEED.collector2);
    const res = await other.get(`/vault/items/${item.id}`);
    expect([403, 404]).toContain(res.status);
  });

  it('cannot read another collector’s item timeline or storage position', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Also Red' });
    const other = await signIn(SEED.collector2);

    for (const path of [`/vault/items/${item.id}/timeline`, `/vault/items/${item.id}/storage`]) {
      const res = await other.get(path);
      expect([403, 404], `${path} leaked to a stranger`).toContain(res.status);
    }
  });

  it('cannot read another collector’s parcel', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);

    const registered = await collector.post('/me/parcels', {
      facilityCode: 'NJ',
      carrier: 'UPS',
      trackingNumber: `AUTHZ-${Date.now()}`,
    });
    expect(registered.status).toBe(201);

    const other = await signIn(SEED.collector2);
    const res = await other.get(`/parcels/${registered.body.id}`);
    expect([403, 404]).toContain(res.status);

    const staff = await operator.get(`/parcels/${registered.body.id}`);
    expect(staff.status).toBe(200);
  });

  it('cannot cancel another collector’s registered parcel', async () => {
    const collector = await signIn(SEED.collector);
    const registered = await collector.post('/me/parcels', {
      facilityCode: 'NJ',
      trackingNumber: `AUTHZ-CANCEL-${Date.now()}`,
    });
    const other = await signIn(SEED.collector2);
    const res = await other.post(`/me/parcels/${registered.body.id}/cancel`, {});
    expect(res.status).toBeGreaterThanOrEqual(400);

    const still = await collector.get(`/parcels/${registered.body.id}`);
    expect(still.status).toBe(200);
    expect(still.body.parcel.status).toBe('expected');
  });

  it('cannot read another collector’s support ticket', async () => {
    const collector = await signIn(SEED.collector);
    const created = await collector.post('/support/tickets', {
      category: 'account',
      subject: 'A private matter',
      body: 'This should not be readable by another collector.',
    });
    expect(created.status).toBe(201);

    const other = await signIn(SEED.collector2);
    const res = await other.get(`/support/tickets/${created.body.id}`);
    expect([403, 404]).toContain(res.status);
  });

  it('cannot post into another collector’s support ticket', async () => {
    const collector = await signIn(SEED.collector);
    const created = await collector.post('/support/tickets', {
      category: 'account',
      subject: 'Also private',
      body: 'Nobody else writes here.',
    });
    const other = await signIn(SEED.collector2);
    const res = await other.post(`/support/tickets/${created.body.id}/messages`, {
      body: 'I should not be able to say this.',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('cannot ship an item it does not own', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Not yours' });

    const other = await signIn(SEED.collector2);
    const address = await other.post('/me/addresses', {
      label: 'Thief',
      recipient: 'Somebody Else',
      line1: '1 Nowhere',
      city: 'Trenton',
      region: 'NJ',
      country: 'US',
      postalCode: '08608',
    });
    const res = await other.post('/shipping/shipments', {
      itemIds: [item.id],
      addressId: address.body.id,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('cannot list an item it does not own for sale', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Still not yours' });

    const other = await signIn(SEED.collector2);
    const res = await other.post('/marketplace/listings', { itemId: item.id, askingPrice: 100_00 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('cannot use another collector’s saved address as a delivery target', async () => {
    const collector = await signIn(SEED.collector);
    const mine = await collector.post('/me/addresses', {
      label: 'Home',
      recipient: 'Red Ashwood',
      line1: '12 Vine St',
      city: 'Trenton',
      region: 'NJ',
      country: 'US',
      postalCode: '08608',
    });

    const operator = await signIn(SEED.operator);
    const theirItem = await intakeFor(operator, SEED.collector2, { description: 'Golden owns it' });

    const other = await signIn(SEED.collector2);
    const res = await other.post('/shipping/shipments', {
      itemIds: [theirItem.id],
      addressId: mine.body.id,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('cannot delete another collector’s address', async () => {
    const collector = await signIn(SEED.collector);
    const mine = await collector.post('/me/addresses', {
      label: 'Deletable',
      recipient: 'Red Ashwood',
      line1: '9 Vine St',
      city: 'Trenton',
      region: 'NJ',
      country: 'US',
      postalCode: '08608',
    });
    const other = await signIn(SEED.collector2);
    const res = await other.del(`/me/addresses/${mine.body.id}`);
    expect(res.status).toBeGreaterThanOrEqual(400);

    const still = await collector.get('/me/addresses');
    expect((still.body as { id: string }[]).some((a) => a.id === mine.body.id)).toBe(true);
  });
});

describe('session handling', () => {
  it('stops accepting the cookie after logout', async () => {
    const collector = await signIn(SEED.collector);
    expect((await collector.get('/me/profile')).status).toBe(200);

    await collector.post('/auth/logout');
    const after = await collector.get('/me/profile');
    expect(after.status).toBe(401);
  });

  it('refuses the very cookie it issued, once that session has signed out (N12)', async () => {
    const collector = await signIn(SEED.collector);
    const stolen = (collector as unknown as { cookie: string }).cookie;
    expect(stolen).toMatch(/=.+/);

    expect((await collector.post('/auth/logout')).status).toBe(204);

    const thief = new Client();
    (thief as unknown as { cookie: string }).cookie = stolen;
    const res = await thief.get('/me/profile');
    expect(res.status).toBe(401);
  });

  it('refuses a forged session cookie', async () => {
    const forged = new Client();
    (forged as unknown as { cookie: string }).cookie = 'bault_session=00000000-0000-0000-0000-000000000000';
    const res = await forged.get('/me/profile');
    expect(res.status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('stops an unauthenticated caller from using password reset as a mail cannon', async () => {
    const anon = new Client();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await anon.post('/auth/password/reset-request', {
        email: `flood-${i}@fixture.bault.test`,
      });
      statuses.push(res.status);
    }

    expect(statuses, `no request was throttled: ${statuses.join(',')}`).toContain(429);

    const throttled = await anon.post('/auth/password/reset-request', {
      email: 'flood-last@fixture.bault.test',
    });
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.code).toBe('rate_limited');
    expect(throttled.body.error.message).toMatch(/too many/i);
  });
});
