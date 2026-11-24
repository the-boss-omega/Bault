import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from '../integration/helpers/http';
import { closeDb, holdRowLock, sql, waitForLockWaiters } from '../integration/helpers/db';

type Res = Awaited<ReturnType<Client['post']>>;
const ok = (r: Res) => r.status >= 200 && r.status < 300;

afterAll(closeDb);

const DESTINATION = {
  destinationAddress: 'Red, 1200 Market St, San Francisco 94102, US',
  destinationCountry: 'US',
  destinationPostalCode: '94102',
};

const openShipmentsWith = async (itemId: string) =>
  (
    await sql<{ n: number }>(
      `select count(*)::int as n from shipment
        where item_ids ? $1 and status in ('requested','awaiting_payment','rates_selected','picking','packed','labeled')`,
      [itemId],
    )
  )[0]!.n;

async function requests(n: number, label: string) {
  const operator = await signIn(SEED.operator);
  const collector = await signIn(SEED.collector);
  await fundWallet(SEED.collector, 10_000);
  const items = await Promise.all(
    Array.from({ length: n }, (_, i) => intakeFor(operator, SEED.collector, { description: `merge race ${label} ${i}` })),
  );
  const shipments: { id: string; code: string }[] = [];
  for (const it of items) {
    const res = await collector.post('/shipping/shipments', { itemIds: [it.id], ...DESTINATION });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    shipments.push(res.body);
  }
  return { collector, items: items as { id: string }[], shipments };
}

async function together(lockId: string, waiters: number, fire: (() => Promise<Res>)[]): Promise<Res[]> {
  const held = await holdRowLock('shipment', lockId);
  let pending: Promise<Res>[] = [];
  try {
    pending = fire.map((f) => f());
    await waitForLockWaiters(waiters);
  } finally {
    await held.release();
  }
  return Promise.all(pending);
}

describe('concurrency: merging shipment requests', () => {
  it('one request merged into two others at once goes into exactly one of them', async () => {
    const { collector, items, shipments } = await requests(3, 'one into two');
    const [a, b, c] = shipments as [{ id: string }, { id: string }, { id: string }];

    const res = await together(b.id, 2, [
      () => collector.post(`/shipping/shipments/${a.id}/merge`, { sourceShipmentId: b.id }),
      () => collector.post(`/shipping/shipments/${c.id}/merge`, { sourceShipmentId: b.id }),
    ]);

    expect(res.filter(ok)).toHaveLength(1);
    expect(res.filter((r) => !ok(r)).map((r) => r.status)).toEqual([409]);
    expect(await openShipmentsWith(items[1]!.id)).toBe(1);
    const [absorbed] = await sql<{ status: string }>(`select status from shipment where id = $1`, [b.id]);
    expect(absorbed!.status).toBe('cancelled');
  });

  it('two requests merged into each other at once: one absorbs the other, and nothing deadlocks', async () => {
    const { collector, items, shipments } = await requests(2, 'each other');
    const [a, b] = shipments as [{ id: string }, { id: string }];
    const first = [a.id, b.id].sort()[0]!;

    const res = await together(first, 2, [
      () => collector.post(`/shipping/shipments/${a.id}/merge`, { sourceShipmentId: b.id }),
      () => collector.post(`/shipping/shipments/${b.id}/merge`, { sourceShipmentId: a.id }),
    ]);

    expect(res.filter(ok)).toHaveLength(1);
    expect(res.filter((r) => !ok(r)).map((r) => r.status)).toEqual([409]);
    for (const it of items) expect(await openShipmentsWith(it.id)).toBe(1);
    const statuses = await sql<{ status: string }>(
      `select status::text from shipment where id = any($1::uuid[])`,
      [[a.id, b.id]],
    );
    expect(statuses.map((s) => s.status).sort()).toEqual(['cancelled', 'requested']);
  });
});
