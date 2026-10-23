import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from '../integration/helpers/http';
import { closeDb, holdRowLock, sql, waitForLockWaiters } from '../integration/helpers/db';

type Res = Awaited<ReturnType<Client['post']>>;
const ok = (r: Res) => r.status >= 200 && r.status < 300;
const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

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

describe('concurrency: one item on two open shipments', () => {
  it('two edits adding the same card to two requests: exactly one gets it', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 5_000);
    const [a, b, shared] = await Promise.all(
      ['edit race: A', 'edit race: B', 'edit race: shared'].map((description) => intakeFor(operator, SEED.collector, { description })),
    );
    const firstRes = await collector.post('/shipping/shipments', { itemIds: [a.id], ...DESTINATION });
    const secondRes = await collector.post('/shipping/shipments', { itemIds: [b.id], ...DESTINATION });
    expect([firstRes.status, secondRes.status], JSON.stringify(firstRes.body)).toEqual([201, 201]);
    const [first, second] = [firstRes.body, secondRes.body];

    const held = await holdRowLock('shipment', first.id);
    let edits: Promise<Res>[] = [];
    try {
      const one = collector.patch(`/shipping/shipments/${first.id}`, { itemIds: [a.id, shared.id] });
      await waitForLockWaiters(1);
      const two = collector.patch(`/shipping/shipments/${second.id}`, { itemIds: [b.id, shared.id] });
      await new Promise((r) => setTimeout(r, 300));
      edits = [one, two];
    } finally {
      await held.release();
    }
    const res = await Promise.all(edits);

    expect(res.filter(ok)).toHaveLength(1);
    expect(res.filter((r) => !ok(r)).map((r) => r.status)).toEqual([409]);
    expect(await openShipmentsWith(shared.id)).toBe(1);
  });

  it('asking for the same card to be hand-delivered twice at once: exactly one request', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 10_000);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description: 'Hand delivery twice' });
    const body = {
      itemIds: [card.id],
      pickupAddress: 'Bault NJ vault',
      pickupFrom: soon(5),
      pickupTo: soon(6),
      deliveryAddress: 'The Langham, Boston MA',
      deliverFrom: soon(6),
      deliverTo: soon(7),
      destinationCountry: 'US',
    };

    const held = await holdRowLock('item', card.id);
    let requests: Promise<Res>[] = [];
    try {
      requests = Array.from({ length: 4 }, () => collector.post('/shipping/white-glove', body));
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      await held.release();
    }
    const res = await Promise.all(requests);

    expect(res.filter(ok)).toHaveLength(1);
    expect(res.filter((r) => !ok(r)).every((r) => r.status === 409)).toBe(true);
    expect(await openShipmentsWith(card.id)).toBe(1);
  });
});
