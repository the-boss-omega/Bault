import { describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';

/**
 * NOT — the notification feed (Requirement 6.1).
 *
 * Every notification must render as a properly formatted, human-readable message,
 * never as a tuple of opaque strings. The dispatcher writes a rendered `message`
 * into each notification's jsonb content, so the feed can display it directly.
 */
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
      // A real sentence, not an id fragment or a serialized payload.
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
    // At least one money-bearing notification is seeded, and it reads as dollars.
    expect(messages.some((m) => m.includes('$'))).toBe(true);
  });

  it('defaults every event type to enabled in-app and honours an explicit opt-out', async () => {
    const c = await signIn(SEED.collector);

    /**
     * The endpoint returns the whole MATRIX now, not the handful of rows the
     * user had already changed.
     *
     * That is a deliberate shape change and it is the point of the pass: the old
     * array could tell a settings screen what somebody had turned off and had no
     * way to tell it what could be turned off. The claim under test is unchanged
     * — a default is on, an explicit opt-out is honoured — and `rows` still
     * carries the raw evidence of what was actually chosen.
     */
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

    // Restore, so re-running the suite against the same DB stays idempotent.
    await fetchPreference(c, 'item_received', true);
  });
});

/** Preferences use PUT, which the shared test Client does not expose. */
async function fetchPreference(
  c: { request: (m: string, p: string, b?: unknown) => Promise<{ status: number }> },
  eventType: string,
  enabled: boolean,
): Promise<boolean> {
  // No `channel` sent on purpose: the DTO defaults it to `in_app`, so a client
  // written against the one-boolean shape still targets the channel it meant.
  const res = await c.request('PUT', '/notifications/preferences', { eventType, enabled });
  return res.status === 200 || res.status === 201;
}
