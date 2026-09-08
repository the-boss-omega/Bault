import { describe, it, expect } from 'vitest';
import { SEED, signIn, intakeFor, fundWallet, usernameOf } from '../../tests/integration/helpers/http';

/**
 * Whole journeys, and the transitions that must not be possible.
 *
 * Two things this covers that no other suite does.
 *
 * FIRST, the modules nobody had tested: the helpdesk end to end, arrival
 * disposals from both sides, the admin surface, consignment and buyout. A module
 * with no test is a module whose first bug is found by a customer.
 *
 * SECOND, ILLEGAL transitions. Every state machine here is written out as an
 * adjacency list in its service, and every one of those lists is a claim that
 * can be wrong. The happy-path suites walk the legal edges; these walk the
 * illegal ones, which is where a missing guard actually costs something —
 * closing a parcel twice, shipping a sold card, cancelling a paid shipment.
 */

describe('the helpdesk, end to end', () => {
  it('runs a ticket from opening to resolution, with both sides able to write', async () => {
    const collector = await signIn(SEED.collector);
    const operator = await signIn(SEED.operator);

    const opened = await collector.post('/support/tickets', {
      category: 'billing',
      subject: 'A charge I do not recognise',
      body: 'There is an intake fee on my statement I cannot place.',
    });
    expect(opened.status).toBe(201);
    const ticketId = opened.body.id as string;

    // It appears on the collector's own list…
    const mine = await collector.get('/support/tickets');
    expect((mine.body as { id: string }[]).some((t) => t.id === ticketId)).toBe(true);

    // …and in the staff queue.
    const queue = await operator.get('/support/queue');
    expect(queue.status).toBe(200);
    expect((queue.body as { id: string }[]).some((t) => t.id === ticketId)).toBe(true);

    const count = await operator.get('/support/queue/count');
    expect(count.status).toBe(200);

    // Staff take it, answer it, and the collector can answer back.
    const assigned = await operator.post(`/support/tickets/${ticketId}/assign`, {});
    expect(assigned.status).toBe(201);

    const replied = await operator.post(`/support/tickets/${ticketId}/messages`, {
      body: 'That is the intake fee for the card booked in on Tuesday.',
    });
    expect(replied.status).toBe(201);

    const followUp = await collector.post(`/support/tickets/${ticketId}/messages`, {
      body: 'Understood, thank you.',
    });
    expect(followUp.status).toBe(201);

    const thread = await collector.get(`/support/tickets/${ticketId}`);
    expect(thread.status).toBe(200);
    const messages = (thread.body.messages ?? thread.body) as unknown[];
    expect(Array.isArray(messages) ? messages.length : 0).toBeGreaterThanOrEqual(3);

    const resolved = await operator.post(`/support/tickets/${ticketId}/resolve`, {
      resolution: 'Explained the intake fee and pointed at the price list.',
    });
    expect([200, 201]).toContain(resolved.status);
  });

  it('refuses a ticket with no category, subject or body', async () => {
    const collector = await signIn(SEED.collector);
    for (const payload of [
      {},
      { category: 'other' },
      { category: 'other', subject: 'only a subject' },
      { category: 'not-a-category', subject: 'x', body: 'y' },
    ]) {
      const res = await collector.post('/support/tickets', payload);
      expect(res.status, `${JSON.stringify(payload)} was accepted`).toBe(400);
    }
  });
});

describe('arrivals that were not accepted', () => {
  it('records a disposal and shows it to the owner, never to a stranger', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);

    const recorded = await operator.post('/intake/disposals', {
      ownerUsername,
      category: 'gps_tracker',
      outcome: 'destroyed',
      description: 'AirTag taped inside the box lid',
      notes: 'Battery removed and the unit destroyed at the bench; owner notified.',
    });
    expect(recorded.status).toBe(201);
    expect(recorded.body.code).toMatch(/^DSL-/);

    // The owner sees the record of their own property.
    const collector = await signIn(SEED.collector);
    const mine = await collector.get('/me/disposals');
    expect(mine.status).toBe(200);
    expect((mine.body as { code: string }[]).some((d) => d.code === recorded.body.code)).toBe(true);

    // Another collector does not.
    const other = await signIn(SEED.collector2);
    const theirs = await other.get('/me/disposals');
    expect((theirs.body as { code: string }[]).some((d) => d.code === recorded.body.code)).toBe(
      false,
    );
  });

  it('refuses a disposal with an unknown category or outcome, or no explanation', async () => {
    const operator = await signIn(SEED.operator);
    const ownerUsername = await usernameOf(SEED.collector);
    const base = {
      ownerUsername,
      category: 'gps_tracker',
      outcome: 'destroyed',
      description: 'Something',
      notes: 'Some notes about it',
    };

    for (const bad of [
      { ...base, category: 'not-a-category' },
      { ...base, outcome: 'incinerated' },
      { ...base, notes: '' },
      { ...base, description: '' },
      { ...base, ownerUsername: 'nobody-at-all' },
    ]) {
      const res = await operator.post('/intake/disposals', bad);
      expect(res.status, `${JSON.stringify(bad)} was accepted`).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });
});

describe('illegal parcel transitions', () => {
  it('refuses every move that is not on the parcel adjacency list', async () => {
    const operator = await signIn(SEED.operator);
    const collectorUsername = await usernameOf(SEED.collector);

    const received = await operator.post('/parcels/receive', {
      facilityCode: 'NJ',
      addressedTo: collectorUsername,
      trackingNumber: `LIFECYCLE-${Date.now()}`,
    });
    expect(received.status).toBe(201);
    const id = received.body.id as string;

    // received → processed is not an edge: it has not been opened.
    const early = await operator.post(`/parcels/${id}/process`, {});
    expect(early.status).toBe(409);

    // A parcel at a storing facility cannot be forwarded onward.
    const forwarded = await operator.post(`/parcels/${id}/forward`, {});
    expect(forwarded.status).toBeGreaterThanOrEqual(400);

    // Opening requires a recorded finding — "sound" must be asserted, not defaulted.
    const noFinding = await operator.post(`/parcels/${id}/open`, { condition: 'sound' });
    expect(noFinding.status).toBe(400);
    const blankFinding = await operator.post(`/parcels/${id}/open`, {
      condition: 'sound',
      conditionNotes: '   ',
    });
    expect(blankFinding.status).toBe(400);

    const opened = await operator.post(`/parcels/${id}/open`, {
      condition: 'sound',
      conditionNotes: 'Two slabs, box intact.',
    });
    expect(opened.status).toBe(201);

    // opened → opened is not an edge either.
    const reopened = await operator.post(`/parcels/${id}/open`, {
      condition: 'sound',
      conditionNotes: 'Opening it again.',
    });
    expect(reopened.status).toBe(409);

    // Only an unclaimed parcel can be attributed to an account.
    const claimed = await operator.post(`/parcels/${id}/claim`, {
      ownerUsername: collectorUsername,
    });
    expect(claimed.status).toBe(409);
  });

  it('holds an arrival nobody can attribute, and lets it be claimed later', async () => {
    const operator = await signIn(SEED.operator);

    const received = await operator.post('/parcels/receive', {
      facilityCode: 'NJ',
      addressedTo: 'nobody-with-this-name',
      trackingNumber: `UNCLAIMED-${Date.now()}`,
    });
    expect(received.status).toBe(201);
    expect(received.body.status).toBe('unclaimed');

    const id = received.body.id as string;

    // An unclaimed parcel is somebody's property and is not opened.
    const opened = await operator.post(`/parcels/${id}/open`, {
      condition: 'sound',
      conditionNotes: 'Trying to open an unattributed parcel.',
    });
    expect(opened.status).toBeGreaterThanOrEqual(400);

    // Attributing it puts it back on the normal path.
    const username = await usernameOf(SEED.collector);
    const claimed = await operator.post(`/parcels/${id}/claim`, { ownerUsername: username });
    expect(claimed.status).toBe(201);

    const now = await operator.post(`/parcels/${id}/open`, {
      condition: 'sound',
      conditionNotes: 'Now it has an owner.',
    });
    expect(now.status).toBe(201);
  });

  it('will not attribute a parcel to an account that does not exist', async () => {
    const operator = await signIn(SEED.operator);
    const received = await operator.post('/parcels/receive', {
      facilityCode: 'NJ',
      addressedTo: 'also-nobody',
      trackingNumber: `NOCLAIM-${Date.now()}`,
    });
    const res = await operator.post(`/parcels/${received.body.id}/claim`, {
      ownerUsername: 'still-nobody',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('an item cannot be in two places at once', () => {
  it('refuses to list an item that is already listed', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Double listing' });

    const first = await seller.post('/marketplace/listings', {
      itemId: item.id,
      askingPrice: 50_00,
    });
    expect(first.status).toBe(201);

    const second = await seller.post('/marketplace/listings', {
      itemId: item.id,
      askingPrice: 60_00,
    });
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
  });

  it('refuses to ship an item that has already been sold to somebody else', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Sold then shipped' });

    const listing = await seller.post('/marketplace/listings', {
      itemId: item.id,
      askingPrice: 20_00,
    });
    await fundWallet(SEED.collector2, 100_00);
    const buyer = await signIn(SEED.collector2);
    const bought = await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`, {});
    expect(bought.status).toBe(201);

    const address = await seller.post('/me/addresses', {
      label: 'Seller home',
      recipient: 'Red Ashwood',
      line1: '12 Vine St',
      city: 'Trenton',
      country: 'US',
      postalCode: '08608',
    });
    const res = await seller.post('/shipping/shipments', {
      itemIds: [item.id],
      addressId: address.body.id,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('refuses to relocate an item that is on hold', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Held' });

    const held = await operator.post(`/custody/items/${item.id}/hold`, {});
    expect(held.status).toBe(201);

    const bins = await operator.get('/custody/bins');
    const elsewhere = (bins.body as { id: string; active: boolean }[]).find(
      (b) => b.active && b.id !== item.binId,
    )!;

    const moved = await operator.post(`/custody/items/${item.id}/relocate`, {
      binId: elsewhere.id,
    });
    expect(moved.status).toBe(409);

    // Released, it moves.
    const released = await operator.del(`/custody/items/${item.id}/hold`);
    expect([200, 204]).toContain(released.status);
    const again = await operator.post(`/custody/items/${item.id}/relocate`, {
      binId: elsewhere.id,
    });
    expect(again.status).toBe(201);
  });
});

describe('the vault as the owner sees it', () => {
  it('answers counts, storage position and timeline for an owned item', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Vault reads' });

    const counts = await collector.get('/vault/counts');
    expect(counts.status).toBe(200);

    const detail = await collector.get(`/vault/items/${item.id}`);
    expect(detail.status).toBe(200);

    const storage = await collector.get(`/vault/items/${item.id}/storage`);
    expect(storage.status).toBe(200);

    const timeline = await collector.get(`/vault/items/${item.id}/timeline`);
    expect(timeline.status).toBe(200);
    // Every item has at least its intake on the trail.
    expect((timeline.body as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('the admin surface', () => {
  it('lists users, items and transactions, and hides fixture accounts', async () => {
    const admin = await signIn(SEED.admin);

    const users = await admin.get('/admin/users');
    expect(users.status).toBe(200);
    const emails = (users.body as { email: string }[]).map((u) => u.email);
    expect(emails).toContain(SEED.collector);
    expect(emails.some((e) => e.endsWith('@fixture.bault.test'))).toBe(false);

    for (const path of ['/admin/items', '/admin/transactions', '/admin/storage-fee-runs']) {
      const res = await admin.get(path);
      expect(res.status, `${path} failed`).toBe(200);
    }
  });

  it('will not let an admin rename an account’s username', async () => {
    const admin = await signIn(SEED.admin);
    const users = await admin.get('/admin/users');
    const target = (users.body as { id: string; username: string }[]).find(
      (u) => u.username === 'red',
    )!;

    const res = await admin.patch(`/admin/users/${target.id}`, { username: 'renamed' });
    expect(res.status).toBe(400);

    const after = await admin.get('/admin/users');
    expect(
      (after.body as { id: string; username: string }[]).find((u) => u.id === target.id)!.username,
    ).toBe('red');
  });

  it('refuses a dispute against a transaction that does not exist', async () => {
    const admin = await signIn(SEED.admin);
    const res = await admin.post('/admin/disputes', {
      transactionId: '00000000-0000-0000-0000-000000000000',
      note: 'No such transaction',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('notification preferences', () => {
  /**
   * Driven against `collector3` and restored afterwards, on purpose.
   *
   * `/notifications/preferences/channel` is a MASTER switch: it turns a channel
   * off for every event at once. Running it against a shared seeded account and
   * walking away broke `not-channels-and-content.test.ts`, which asserts that
   * account's default email matrix — a suite-order-dependent failure that only
   * appears in a full run. The suite has no per-test isolation, so a test that
   * mutates account-level settings has to put them back.
   */
  it('round-trips a per-event and a per-channel switch, and restores them', async () => {
    const collector = await signIn(SEED.collector3);

    const before = await collector.get('/notifications/preferences');
    expect(before.status).toBe(200);

    const perEvent = await collector.put('/notifications/preferences', {
      eventType: 'item_received',
      enabled: false,
    });
    expect([200, 201]).toContain(perEvent.status);

    const perChannel = await collector.put('/notifications/preferences/channel', {
      channel: 'email',
      enabled: false,
    });
    expect([200, 201]).toContain(perChannel.status);

    const after = await collector.get('/notifications/preferences');
    expect(after.status).toBe(200);
    const emailFor = (body: unknown, key: string) =>
      (body as { events: { eventType: string; channels: { channel: string; enabled: boolean }[] }[] })
        .events.find((e) => e.eventType === key)!
        .channels.find((c) => c.channel === 'email')!.enabled;
    // The master switch really did reach every event, which is what makes it a
    // master switch and why it has to be put back.
    expect(emailFor(after.body, 'item_sold')).toBe(false);

    await collector.put('/notifications/preferences/channel', { channel: 'email', enabled: true });
    await collector.put('/notifications/preferences', {
      eventType: 'item_received',
      enabled: true,
    });

    const restored = await collector.get('/notifications/preferences');
    expect(emailFor(restored.body, 'item_sold')).toBe(true);
  });

  it('refuses an unknown channel', async () => {
    const collector = await signIn(SEED.collector3);
    const res = await collector.put('/notifications/preferences/channel', {
      channel: 'carrier-pigeon',
      enabled: true,
    });
    expect(res.status).toBe(400);
  });
});

describe('consignment and buyout', () => {
  it('publishes its channels and refuses an unknown one', async () => {
    const collector = await signIn(SEED.collector);
    const channels = await collector.get('/services/consignment/channels');
    expect(channels.status).toBe(200);
    expect((channels.body.channels as unknown[]).length).toBeGreaterThan(0);

    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Consign me' });

    const bad = await collector.post('/services/consignment', {
      itemId: item.id,
      channel: 'car-boot-sale',
      askingMinor: 100_00,
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
  });

  it('runs a buyout from request to quote to decline, leaving the item with the owner', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Buyout candidate' });

    const requested = await collector.post('/services/buyout', { itemId: item.id });
    expect(requested.status).toBe(201);
    const requestId = requested.body.id as string;

    // A quote before staff have accepted the request is refused: the service
    // workflow is requested → accepted → in progress, and quoting is work.
    const premature = await operator.post(`/services/buyout/${requestId}/quote`, {
      offerMinor: 25_00,
      rationale: 'Quoting before accepting.',
      itemVerified: true,
    });
    expect(premature.status).toBe(409);

    const accepted = await operator.post(`/services/requests/${requestId}/accept`, {});
    expect(accepted.status).toBe(201);

    // A quote must carry a rationale and an explicit verification.
    const unverified = await operator.post(`/services/buyout/${requestId}/quote`, {
      offerMinor: 25_00,
      rationale: 'Looks fine',
      itemVerified: false,
    });
    expect(unverified.status).toBe(400);

    const quoted = await operator.post(`/services/buyout/${requestId}/quote`, {
      offerMinor: 25_00,
      rationale: 'Centred, sharp corners, light surface wear.',
      itemVerified: true,
    });
    expect(quoted.status).toBe(201);

    const declined = await collector.post(`/services/buyout/${requestId}/decline`, {});
    expect(declined.status).toBe(201);

    // Declined: the card is still the collector's.
    const vault = await collector.get('/vault/items');
    expect((vault.body as { id: string }[]).some((i) => i.id === item.id)).toBe(true);
  });
});
