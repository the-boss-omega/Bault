import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from '../integration/helpers/http';
import { activeAccount, passwordOnly } from '../integration/helpers/mfa';
import { closeDb, sql } from '../integration/helpers/db';

afterAll(async () => {
  await closeDb();
});

describe('concurrency: a unique violation is a conflict, never a crash', () => {
  it('six parallel offers from one buyer on one listing leave one pending offer, one 201 and the rest 409', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const seller = await signIn(SEED.collector);
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 30000 });
    expect(listing.status, JSON.stringify(listing.body)).toBe(201);
    const listingId = listing.body.id as string;

    await fundWallet(SEED.collector2, 100000);
    const buyer = await signIn(SEED.collector2);

    const answers = await Promise.all(
      Array.from({ length: 6 }, () => buyer.post(`/marketplace/listings/${listingId}/offers`, { amount: 20000 })),
    );

    const statuses = answers.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(answers.map((r) => r.body))).toEqual([201, 409, 409, 409, 409, 409]);
    for (const refused of answers.filter((r) => r.status === 409)) {
      expect(refused.body.error.code).toBe('conflict');
      expect(refused.body.error.message).toMatch(/already have an offer/i);
    }

    const pending = await sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM offer WHERE listing_id = $1 AND status = 'pending'`,
      [listingId],
    );
    expect(pending[0]!.n).toBe('1');
  });

  it('six parallel saves of one new notification preference all succeed and leave one row', async () => {
    const account = await activeAccount('prefrace');
    const c = await passwordOnly(account);

    const answers = await Promise.all(
      Array.from({ length: 6 }, () =>
        c.put('/notifications/preferences', { eventType: 'item_received', channel: 'email', enabled: false }),
      ),
    );

    expect(
      answers.map((r) => r.status),
      JSON.stringify(answers.map((r) => r.body)),
    ).toEqual([200, 200, 200, 200, 200, 200]);

    const rows = await sql<{ enabled: boolean }>(
      `SELECT enabled FROM notification_preference WHERE user_id = $1 AND event_type = 'item_received' AND channel = 'email'`,
      [account.id],
    );
    expect(rows).toEqual([{ enabled: false }]);
  });
});
