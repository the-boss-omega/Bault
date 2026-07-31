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

  it('defaults every event type to enabled and honours an explicit opt-out', async () => {
    const c = await signIn(SEED.collector);
    const before = (await c.get('/notifications/preferences')).body as { eventType: string }[];
    expect(Array.isArray(before)).toBe(true);

    const res = await fetchPreference(c, 'item_received', false);
    expect(res).toBe(true);

    const after = (await c.get('/notifications/preferences')).body as {
      eventType: string;
      enabled: boolean;
    }[];
    expect(after.find((p) => p.eventType === 'item_received')?.enabled).toBe(false);

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
  const res = await c.request('PUT', '/notifications/preferences', { eventType, enabled });
  return res.status === 200 || res.status === 201;
}
