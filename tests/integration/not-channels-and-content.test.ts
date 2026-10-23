import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';

describe('NOT channels and published content', () => {
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
    expect(inAppPref.enabled).toBe(true);
    expect(inAppPref.isDefault).toBe(true);

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

  it('records the channel a notification was delivered on', async () => {
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

  it('publishes the show calendar without a session', async () => {
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

    expect(contact.helpdesk).toBe(true);
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
      expect(l).not.toHaveProperty('line1');
      expect(l).not.toHaveProperty('postalCode');
    }
  });
});
