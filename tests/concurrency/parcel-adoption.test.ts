import { afterAll, describe, it, expect } from 'vitest';
import { SEED, SEED_USERNAME, signIn } from '../integration/helpers/http';
import { closeDb, sql } from '../integration/helpers/db';

/**
 * Booking in a parcel the collector registered.
 *
 * The arrival adopts the `expected` registration whose tracking number it
 * carries: the registration becomes `received`, gets one `received` event on
 * its trail, and the collector is told once. Two operators scanning the same
 * box at the same moment must not both adopt it.
 *
 * Requires a running API + a seeded DB.
 */

afterAll(closeDb);

describe('two arrivals for one registered parcel at once', () => {
  it('adopts the registration once: one event on its trail, one notice to its owner', async () => {
    const collector = await signIn(SEED.collector);
    const operators = await Promise.all([signIn(SEED.operator), signIn(SEED.admin)]);
    const facilityCode = ((await collector.get('/me/inbound-addresses')).body as { code: string }[])[0]!.code;

    const trackingNumber = `RACE-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const registered = await collector.post('/me/parcels', {
      facilityCode,
      carrier: 'UPS',
      trackingNumber,
      declaredContents: 'One box, scanned twice',
    });
    expect(registered.status).toBe(201);
    const parcelId = registered.body.id as string;

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        operators[i % 2]!.post('/parcels/receive', {
          facilityCode,
          addressedTo: SEED_USERNAME.collector,
          trackingNumber,
        }),
      ),
    );
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);

    // Exactly one of them took over the registration.
    expect(results.filter((r) => r.body?.id === parcelId)).toHaveLength(1);
    const events = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM parcel_event WHERE parcel_id = $1 AND event_type = 'received'`,
      [parcelId],
    );
    expect(events[0]!.n).toBe(1);
    const notices = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_message
        WHERE aggregate_type = 'parcel' AND aggregate_id = $1 AND event_type = 'parcel_received'`,
      [parcelId],
    );
    expect(notices[0]!.n).toBe(1);
  });
});
