import { describe, it, expect } from 'vitest';
import { Client, SEED, signIn, intakeFor } from '../../tests/integration/helpers/http';

/**
 * The authorization matrix.
 *
 * Every other suite in this tree drives a flow from the side that is allowed to
 * drive it. This one does the opposite, because that is where the damage is: a
 * missing guard on a warehouse route is a customer relocating somebody else's
 * card, and a missing ownership check on a read route is one collector reading
 * another's vault.
 *
 * Three probes, applied systematically:
 *
 *   1. ANONYMOUS — no session at all. Everything that is not explicitly
 *      `@Public()` must refuse, and must refuse with 401 rather than 404 or 500.
 *   2. WRONG ROLE — a signed-in customer against staff-only routes, and a
 *      warehouse operator against admin-only routes. Must be 403.
 *   3. WRONG TENANT — a signed-in customer against another customer's own
 *      records. Must not return the record.
 *
 * The routes are listed literally rather than derived, so adding an endpoint
 * without adding it here is a visible omission rather than silent coverage.
 */

/** Staff-only routes, by the method that reaches them. */
const STAFF_ONLY: readonly [string, string][] = [
  // NOTE: `/intake/vocabulary` is deliberately NOT here. It serves the item
  // taxonomy to any signed-in caller, because a collector reading their own
  // disposal list needs the same labels the operator picked from. Documented as
  // such on DisposalController.

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

/** Admin-only routes — a warehouse operator must not reach these either. */
const ADMIN_ONLY: readonly [string, string][] = [
  ['GET', '/admin/users'],
  ['GET', '/admin/items'],
  ['GET', '/admin/disputes'],
  ['GET', '/admin/transactions'],
  ['GET', '/admin/storage-fee-runs'],
  ['GET', '/admin/wallet-requests'],
  ['POST', '/pricing/rules'],
  ['GET', '/finance/chargebacks/reversible'],
  ['GET', '/marketplace/house/manage'],
  ['POST', '/marketplace/house/listings'],
];

/** Routes that must answer with no session at all. */
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

/** Signed-in routes that belong to the caller and nobody else. */
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
    // Same status either way, or the endpoint is an account-existence oracle.
    expect(unknown.status).toBe(known.status);
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

    // …but the operator, who has to handle it physically, can.
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

    // And it is genuinely still there afterwards.
    // `GET /parcels/:id` returns { parcel, events, items } — the record, its
    // trail and what came out of it.
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
    // Golden owns the item but not the address; sending their own card to a
    // stranger's saved address must not be expressible.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('cannot delete another collector’s address', async () => {
    const collector = await signIn(SEED.collector);
    const mine = await collector.post('/me/addresses', {
      label: 'Deletable',
      recipient: 'Red Ashwood',
      line1: '9 Vine St',
      city: 'Trenton',
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

  it('refuses a forged session cookie', async () => {
    const forged = new Client();
    // Reach into the client the way an attacker reaches into a browser: set a
    // plausible-looking session value and see whether the API believes it.
    (forged as unknown as { cookie: string }).cookie = 'bault_session=00000000-0000-0000-0000-000000000000';
    const res = await forged.get('/me/profile');
    expect(res.status).toBe(401);
  });
});

describe('rate limiting', () => {
  /**
   * The mail cannon, closed.
   *
   * `POST /auth/password/reset-request` lets an unauthenticated stranger make
   * Bault send email to any address they name, and it was completely unmetered.
   * Its bucket is deliberately hard-coded rather than configurable — there is no
   * deployment where a higher number is the right answer — so this test does not
   * depend on the local `.env`, which raises the sign-in budget so the suite can
   * run at all.
   */
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

    // …and a throttled caller is told what happened, in the documented error
    // shape. It used to come back as an opaque `internal`, which reads as a
    // server fault and tells a client nothing about backing off.
    const throttled = await anon.post('/auth/password/reset-request', {
      email: 'flood-last@fixture.bault.test',
    });
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.code).toBe('rate_limited');
    expect(throttled.body.error.message).toMatch(/too many/i);
  });
});
