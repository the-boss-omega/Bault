import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from '../integration/helpers/http';
import { closeDb, holdRowLock, sql } from '../integration/helpers/db';

type Res = Awaited<ReturnType<Client['post']>>;
const ok = (r: Res) => r.status >= 200 && r.status < 300;

let showId: string | undefined;

afterAll(async () => {
  if (showId) await sql('update consignment_event set active = false where id = $1', [showId]);
  await closeDb();
});

describe('concurrency: show pickup capacity', () => {
  it('two collectors booking the last place: exactly one gets it', async () => {
    const day = 86_400_000;
    const [show] = await sql<{ id: string }>(
      `insert into consignment_event (name, venue, city, starts_at, ends_at, request_deadline, pickup_enabled, pickup_capacity, pickup_fee_minor)
       values ($1, 'Hall C', 'Secaucus', $2, $3, $4, true, 1, 1500) returning id`,
      [`Last place in the van ${Date.now()}`, new Date(Date.now() + 10 * day), new Date(Date.now() + 11 * day), new Date(Date.now() + 5 * day)],
    );
    showId = show!.id;

    const operator = await signIn(SEED.operator);
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    await fundWallet(SEED.collector, 5_000);
    await fundWallet(SEED.collector2, 5_000);
    const redCard = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description: 'Last place: Red' });
    const goldenCard = await intakeFor(operator, SEED.collector2, { typeClass: 'graded_slab', description: 'Last place: Golden' });

    const holdRed = await holdRowLock('item', redCard.id);
    const holdGolden = await holdRowLock('item', goldenCard.id);
    let bookings: Promise<Res>[] = [];
    try {
      bookings = [
        red.post('/shipping/pickup', { itemIds: [redCard.id], eventId: showId }),
        golden.post('/shipping/pickup', { itemIds: [goldenCard.id], eventId: showId }),
      ];
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      await Promise.all([holdRed.release(), holdGolden.release()]);
    }
    const res = await Promise.all(bookings);

    expect(res.filter(ok)).toHaveLength(1);
    expect(res.filter((r) => !ok(r)).map((r) => r.status)).toEqual([409]);
    const [booked] = await sql<{ n: number }>(
      `select count(*)::int as n from shipment where pickup_event_id = $1 and status <> 'cancelled'`,
      [showId],
    );
    expect(booked!.n).toBe(1);
  });
});
