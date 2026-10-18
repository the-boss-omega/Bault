import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from '../integration/helpers/http';
import { closeDb, holdRowLock, sql, waitForLockWaiters } from '../integration/helpers/db';

type Res = Awaited<ReturnType<Client['post']>>;
const ok = (r: Res) => r.status >= 200 && r.status < 300;
const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;
const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

afterAll(closeDb);

async function quotedHandDelivery(label: string, quoteMinor: number) {
  const operator = await signIn(SEED.operator);
  const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description: label });
  const collector = await signIn(SEED.collector);
  await fundWallet(SEED.collector, quoteMinor * 3);
  const requested = await collector.post('/shipping/white-glove', {
    itemIds: [card.id],
    pickupAddress: 'Bault NJ vault',
    pickupFrom: soon(5),
    pickupTo: soon(6),
    deliveryAddress: 'The Langham, Boston MA',
    deliverFrom: soon(6),
    deliverTo: soon(7),
    destinationCountry: 'US',
    recipientName: 'Red Ashwood',
  });
  expect(requested.status).toBe(201);
  const shipmentId = requested.body.id as string;
  const quoted = await operator.post(`/shipping/white-glove/${shipmentId}/quote`, {
    quoteMinor,
    notes: 'Base plus travel, Newark to Boston and back the same day.',
  });
  expect(quoted.status).toBe(201);
  return { operator, collector, shipmentId };
}

describe('concurrency: hand-delivery quotes', () => {
  it('two accepts queued on the same quote charge it once', async () => {
    const QUOTE = 40_000;
    const { collector, shipmentId } = await quotedHandDelivery('Two accepts', QUOTE);
    const before = await balanceOf(collector);

    const lock = await holdRowLock('shipment', shipmentId);
    let accepts: Promise<Res>[] = [];
    try {
      accepts = [0, 1, 2].map(() => collector.post(`/shipping/white-glove/${shipmentId}/accept`));
      await waitForLockWaiters(3);
    } finally {
      await lock.release();
    }
    const res = await Promise.all(accepts);

    expect({ wins: res.filter(ok).length, charged: before - (await balanceOf(collector)) }).toEqual({
      wins: 1,
      charged: QUOTE,
    });
    expect(res.filter((r) => !ok(r)).every((r) => r.status === 409)).toBe(true);
  });

  it('a revised quote that arrives as the collector accepts is refused, not written over the charge', async () => {
    const FIRST = 50_000;
    const REVISED = 65_000;
    const { operator, collector, shipmentId } = await quotedHandDelivery('Quote racing accept', FIRST);
    const before = await balanceOf(collector);

    const lock = await holdRowLock('shipment', shipmentId);
    let accept: Promise<Res> | undefined;
    let revise: Promise<Res> | undefined;
    try {
      accept = collector.post(`/shipping/white-glove/${shipmentId}/accept`);
      await waitForLockWaiters(1);
      revise = operator.post(`/shipping/white-glove/${shipmentId}/quote`, {
        quoteMinor: REVISED,
        notes: 'Revised: a toll road was missed.',
      });
      await waitForLockWaiters(2);
    } finally {
      await lock.release();
    }
    const [accepted, revised] = await Promise.all([accept!, revise!]);

    expect(accepted.status).toBe(201);
    expect(accepted.body.cost).toBe(FIRST);
    expect(before - (await balanceOf(collector))).toBe(FIRST);
    const [row] = await sql<{ quote_minor: number; cost: number; status: string }>(
      'select quote_minor, cost::int as cost, status from shipment where id = $1',
      [shipmentId],
    );
    expect(row).toEqual({ quote_minor: FIRST, cost: FIRST, status: 'rates_selected' });
    expect(revised.status).toBe(409);
  });
});
