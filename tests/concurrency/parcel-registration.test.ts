import { afterAll, describe, it, expect } from 'vitest';
import { SEED, signIn } from '../integration/helpers/http';
import { closeDb, sql } from '../integration/helpers/db';

afterAll(closeDb);

describe('one tracking number registered by several people at once', () => {
  it('lets exactly one registration through each time', async () => {
    const people = await Promise.all([signIn(SEED.collector), signIn(SEED.collector2), signIn(SEED.collector3)]);
    for (let round = 0; round < 8; round += 1) {
      const trackingNumber = `REG-RACE-${Date.now()}-${round}-${Math.floor(Math.random() * 1e6)}`;
      const results = await Promise.all(
        people.map((p) => p.post('/me/parcels', { facilityCode: 'NJ', carrier: 'UPS', trackingNumber })),
      );
      for (const r of results) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      const open = await sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM parcel WHERE tracking_number = $1 AND status = 'expected'`,
        [trackingNumber],
      );
      expect(open[0]!.n).toBe(1);
    }
  });
});
