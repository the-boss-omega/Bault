import { afterAll, describe, it, expect } from 'vitest';
import { SEED, signIn, type Client } from '../integration/helpers/http';
import { closeDb, sql } from '../integration/helpers/db';

/**
 * Resolving a support ticket is a status change with a notification attached:
 * the customer is told their ticket was resolved. Two staff pressing Resolve
 * together must resolve it once and tell the customer once.
 *
 * Requires a running API + a seeded DB.
 */

afterAll(closeDb);

type Res = Awaited<ReturnType<Client['post']>>;
const ok = (r: Res) => r.status >= 200 && r.status < 300;

describe('resolving a support ticket twice at once', () => {
  it('resolves it once, refuses the rest, and notifies the customer once', async () => {
    const collector = await signIn(SEED.collector);
    const staff = await Promise.all([signIn(SEED.operator), signIn(SEED.admin)]);

    for (let round = 0; round < 3; round += 1) {
      const opened = await collector.post('/support/tickets', {
        category: 'other',
        subject: `Resolve race ${round}`,
        body: 'Two people will close this at the same moment.',
      });
      expect(opened.status).toBe(201);
      const ticketId = opened.body.id as string;

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => staff[i % 2]!.post(`/support/tickets/${ticketId}/resolve`, {})),
      );
      expect(results.filter(ok), JSON.stringify(results.map((r) => r.status))).toHaveLength(1);
      for (const r of results.filter((x) => !ok(x))) expect(r.status).toBe(409);

      const told = await sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM outbox_message
          WHERE aggregate_type = 'support_ticket' AND aggregate_id = $1 AND event_type = 'support_ticket_resolved'`,
        [ticketId],
      );
      expect(told[0]!.n).toBe(1);
    }
  });
});
