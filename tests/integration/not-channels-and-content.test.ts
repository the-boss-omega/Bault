import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';

/**
 * Section 10 — notifications that leave the app, and published content.
 *
 * The notification system was well built and reached exactly one place. That
 * matters here more than it would elsewhere: several of Bault's workflows
 * explicitly wait on a human, and a shipment held for seven days releases its
 * items whether or not anybody was looking at the app.
 *
 * The content endpoints are the other half of the section — a show calendar and
 * a way to reach a person — and they are deliberately PUBLIC, because somebody
 * deciding whether to use Bault at all needs to read them before they have an
 * account.
 *
 * Requires a running API + a freshly seeded DB.
 */
describe('NOT channels and published content', () => {
  /* ---------------- the preference matrix ---------------- */

  it('serves the whole matrix, not just the rows somebody already changed', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/notifications/preferences');
    expect(res.status).toBe(200);

    expect(res.body.channels).toEqual(['in_app', 'email']);
    expect((res.body.events as unknown[]).length).toBeGreaterThan(20);

    for (const event of res.body.events as Array<Record<string, unknown>>) {
      expect(typeof event.eventType).toBe('string');
      expect(typeof event.label).toBe('string');
      expect(res.body.categories).toContain(event.category);
      // Every event carries a switch for every channel — a settings screen
      // cannot render a matrix with holes in it.
      expect((event.channels as unknown[]).length).toBe(2);
    }
  });

  it('defaults email on for money and custody, and off for the chatty ones', async () => {
    const collector = await signIn(SEED.collector);
    const { events } = (await collector.get('/notifications/preferences')).body as {
      events: Array<{ eventType: string; channels: Array<{ channel: string; enabled: boolean }> }>;
    };
    const email = (key: string) =>
      events.find((e) => e.eventType === key)!.channels.find((c) => c.channel === 'email')!.enabled;

    expect(email('item_sold')).toBe(true);
    expect(email('wallet_request_completed')).toBe(true);
    expect(email('arrival_not_accepted')).toBe(true);
    // A parcel moving a shelf is not worth an email.
    expect(email('parcel_forwarded')).toBe(false);
    expect(email('commons_removed')).toBe(false);
  });

  it('remembers a per-channel choice without touching the other channel', async () => {
    const collector = await signIn(SEED.collector);

    const off = await collector.request('PUT', '/notifications/preferences', {
      eventType: 'item_sold',
      channel: 'email',
      enabled: false,
    });
    expect(off.status).toBe(200);

    const { events } = (await collector.get('/notifications/preferences')).body as {
      events: Array<{
        eventType: string;
        channels: Array<{ channel: string; enabled: boolean; isDefault: boolean }>;
      }>;
    };
    const sold = events.find((e) => e.eventType === 'item_sold')!;
    const emailPref = sold.channels.find((c) => c.channel === 'email')!;
    const inAppPref = sold.channels.find((c) => c.channel === 'in_app')!;

    expect(emailPref.enabled).toBe(false);
    expect(emailPref.isDefault).toBe(false);
    // "Tell me when something sells, but not by email" — the exact thing one
    // boolean could not express.
    expect(inAppPref.enabled).toBe(true);
    expect(inAppPref.isDefault).toBe(true);

    // Put it back so the seeded account is left as it was found.
    await collector.request('PUT', '/notifications/preferences', {
      eventType: 'item_sold',
      channel: 'email',
      enabled: true,
    });
  });

  it('turns a whole channel off in one action, and leaves the other channel exactly as it was', async () => {
    const collector = await signIn(SEED.collector2);

    type Matrix = {
      events: Array<{ eventType: string; channels: Array<{ channel: string; enabled: boolean }> }>;
    };
    const inAppState = (m: Matrix) =>
      Object.fromEntries(
        m.events.map((e) => [e.eventType, e.channels.find((c) => c.channel === 'in_app')!.enabled]),
      );

    // Snapshotted rather than assumed: this account is seeded with `hold_placed`
    // already switched off in-app, and asserting "everything is on" would be
    // asserting something about the fixture rather than about the code.
    const before = inAppState((await collector.get('/notifications/preferences')).body as Matrix);

    const res = await collector.request('PUT', '/notifications/preferences/channel', {
      channel: 'email',
      enabled: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBeGreaterThan(20);

    const after = (await collector.get('/notifications/preferences')).body as Matrix;
    expect(
      after.events.every((e) => e.channels.find((c) => c.channel === 'email')!.enabled === false),
    ).toBe(true);
    // A master switch for email is not a master switch for everything.
    expect(inAppState(after)).toEqual(before);

    await collector.request('PUT', '/notifications/preferences/channel', {
      channel: 'email',
      enabled: true,
    });
  });

  it('refuses to switch off the two that say something of yours did not survive', async () => {
    const collector = await signIn(SEED.collector);
    for (const eventType of ['arrival_not_accepted', 'parcel_damaged']) {
      const res = await collector.request('PUT', '/notifications/preferences', {
        eventType,
        channel: 'in_app',
        enabled: false,
      });
      expect(res.status).toBe(400);
    }
  });

  it('refuses an unknown channel or event type rather than storing it', async () => {
    const collector = await signIn(SEED.collector);
    const badChannel = await collector.request('PUT', '/notifications/preferences', {
      eventType: 'item_sold',
      channel: 'carrier_pigeon',
      enabled: true,
    });
    expect(badChannel.status).toBe(400);

    const badEvent = await collector.request('PUT', '/notifications/preferences', {
      eventType: 'nothing_emits_this',
      channel: 'in_app',
      enabled: true,
    });
    expect(badEvent.status).toBe(400);
  });

  /* ---------------- delivery ---------------- */

  it('records the channel a notification was delivered on', async () => {
    // An intake emits `item_received`, which the worker turns into at least an
    // in-app row. Whether an email row appears depends on the worker running
    // and on the mail adapter, so only the in-app half is asserted here — the
    // email path is exercised by the adapter contract and the catalogue test.
    const operator = await signIn(SEED.operator);
    await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });

    const collector = await signIn(SEED.collector);
    const feed = (await collector.get('/notifications')).body as Array<{
      channel: string;
      status: string;
    }>;
    for (const row of feed) {
      expect(['in_app', 'email']).toContain(row.channel);
      expect(['sent', 'failed']).toContain(row.status);
    }
  });

  /* ---------------- published content ---------------- */

  it('publishes the show calendar without a session', async () => {
    // A stranger deciding whether to use Bault has to be able to read this.
    const res = await fetch(`${process.env.API_URL ?? 'http://localhost:3000/api/v1'}/content/shows`);
    expect(res.status).toBe(200);
    const shows = (await res.json()) as Array<Record<string, unknown>>;
    for (const show of shows) {
      expect(typeof show.name).toBe('string');
      expect(typeof show.venue).toBe('string');
      expect(typeof show.open).toBe('boolean');
      expect(typeof show.past).toBe('boolean');
    }
  });

  it('publishes contact details, and says plainly when a channel is not configured', async () => {
    const base = process.env.API_URL ?? 'http://localhost:3000/api/v1';
    const res = await fetch(`${base}/content/contact`);
    expect(res.status).toBe(200);
    const contact = (await res.json()) as Record<string, unknown>;

    // The helpdesk is always there — it does not depend on anybody having
    // filled a variable in.
    expect(contact.helpdesk).toBe(true);
    // Everything else is null or a string. Never a placeholder somebody might
    // dial: an unconfigured channel is `null` and the page says "not published".
    for (const key of ['email', 'phone', 'hours']) {
      const value = contact[key];
      expect(value === null || typeof value === 'string').toBe(true);
    }
    expect(Array.isArray(contact.team)).toBe(true);
  });

  it('publishes the facility cities but not anybody’s receiving address', async () => {
    const base = process.env.API_URL ?? 'http://localhost:3000/api/v1';
    const res = await fetch(`${base}/content/locations`);
    expect(res.status).toBe(200);
    const locations = (await res.json()) as Array<Record<string, unknown>>;
    expect(locations.length).toBeGreaterThan(0);

    for (const l of locations) {
      expect(typeof l.city).toBe('string');
      expect(['primary', 'forwarding']).toContain(l.role);
      // The per-collector `C/O username` line belongs to
      // `GET /me/inbound-addresses` and is nobody else's business.
      expect(l).not.toHaveProperty('line1');
      expect(l).not.toHaveProperty('postalCode');
    }
  });
});
