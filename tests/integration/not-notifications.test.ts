import { describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';

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
      events: Array<{ eventType: string; channels: Array<{ channel: string; enabled: boolean }> }>;
      rows: Array<{ eventType: string; channel: string; enabled: boolean }>;
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
    expect(
      after.rows.some((r) => r.eventType === 'item_received' && r.channel === 'in_app' && !r.enabled),
    ).toBe(true);

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
