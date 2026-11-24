import { afterAll, describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';
import { activeAccount, passwordOnly } from './helpers/mfa';

afterAll(closeDb);

describe('NOT notification feed', () => {
  it('gives every notification a human-readable message', async () => {
    const c = await signIn(SEED.collector);
    const res = await c.get('/notifications');
    expect(res.status).toBe(200);

    const feed = res.body as { eventType: string; content: Record<string, unknown> }[];
    expect(feed.length).toBeGreaterThan(0);

    for (const n of feed) {
      expect(typeof n.content).toBe('object');
      const message = n.content?.message;
      expect(typeof message).toBe('string');
      expect(String(message).length).toBeGreaterThan(10);
      expect(String(message)).not.toContain('{');
      expect(String(message)).not.toContain('[object Object]');
    }
  });

  it('states amounts in USD, never in another currency (Requirement 7.1)', async () => {
    const c = await signIn(SEED.collector);
    const feed = (await c.get('/notifications')).body as { content: Record<string, unknown> }[];
    const messages = feed.map((n) => String(n.content?.message ?? ''));
    for (const m of messages) {
      expect(m).not.toContain('₪');
      expect(m.toLowerCase()).not.toContain('agorot');
      expect(m).not.toContain('ILS');
    }
    expect(messages.some((m) => m.includes('$'))).toBe(true);
  });

  it('defaults every event type to enabled in-app and honours an explicit opt-out', async () => {
    const c = await signIn(SEED.collector);

    type Matrix = {
      events: Array<{ eventType: string; channels: Array<{ channel: string; enabled: boolean; isDefault: boolean }> }>;
    };
    const inApp = (m: Matrix, key: string) =>
      m.events.find((e) => e.eventType === key)!.channels.find((ch) => ch.channel === 'in_app')!;

    const before = (await c.get('/notifications/preferences')).body as Matrix;
    expect(before.events.length).toBeGreaterThan(0);
    expect(inApp(before, 'item_received').enabled).toBe(true);

    const res = await fetchPreference(c, 'item_received', false);
    expect(res).toBe(true);

    const after = (await c.get('/notifications/preferences')).body as Matrix;
    expect(inApp(after, 'item_received').enabled).toBe(false);
    expect(inApp(after, 'item_received').isDefault).toBe(false);

    await fetchPreference(c, 'item_received', true);
  });
});

async function fetchPreference(
  c: { request: (m: string, p: string, b?: unknown) => Promise<{ status: number }> },
  eventType: string,
  enabled: boolean,
): Promise<boolean> {
  const res = await c.request('PUT', '/notifications/preferences', { eventType, enabled });
  return res.status === 200 || res.status === 201;
}

describe('NOT the feed, a page at a time', () => {
  it('serves the newest first, a limited page, and the next page from a cursor', async () => {
    const account = await activeAccount('feedpage');
    for (let i = 0; i < 5; i += 1) {
      await sql(
        `INSERT INTO notification (user_id, event_type, content, channel, status, created_at)
         VALUES ($1, 'item_received', $2::jsonb, 'in_app', 'sent', now() - make_interval(mins => $3))`,
        [account.id, JSON.stringify({ message: `Page note ${i}` }), i],
      );
    }
    const c = await passwordOnly(account);
    const message = (rows: { content: { message?: string } }[]) => rows.map((r) => r.content.message);

    const first = await c.get('/notifications?limit=2');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(message(first.body)).toEqual(['Page note 0', 'Page note 1']);
    const second = await c.get(`/notifications?limit=2&before=${first.body[1].id}`);
    expect(message(second.body)).toEqual(['Page note 2', 'Page note 3']);
    const last = await c.get(`/notifications?limit=2&before=${second.body[1].id}`);
    expect(message(last.body)).toEqual(['Page note 4']);
    expect(message((await c.get('/notifications')).body)).toHaveLength(5);

    for (const bad of ['limit=0', 'limit=101', 'limit=ten', 'before=not-a-uuid']) {
      expect((await c.get(`/notifications?${bad}`)).status, bad).toBe(400);
    }
  });
});
