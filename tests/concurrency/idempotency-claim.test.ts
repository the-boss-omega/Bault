import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, signIn, type Client } from '../integration/helpers/http';

/**
 * One idempotency key, two requests at the same moment (F064).
 *
 * The key protected only a RETRY: it was looked up before the purchase's
 * transaction and saved after it committed, with nothing claiming it in
 * between. A double-click whose two requests arrived together both missed the
 * lookup, both ran, and a store product with copies in stock sold two of them
 * to one buyer and charged twice — the product lock only put the two in a
 * queue.
 *
 * The key is now claimed by the insert that starts the purchase's own
 * transaction, against a unique index. The second request waits on that claim
 * and then replays what the first one recorded. It never runs.
 *
 * Requires a running API + a freshly seeded DB.
 */

type Res = Awaited<ReturnType<Client['post']>>;
const ok = (r: Res) => r.status >= 200 && r.status < 300;
const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

describe('concurrency: one idempotency key', () => {
  it('runs a purchase once however many requests carry the key at once', async () => {
    const admin = await signIn(SEED.admin);
    const buyer = await signIn(SEED.collector2);
    const PRICE = 1_100;
    const ROUNDS = 5;
    await fundWallet(SEED.collector2, PRICE * ROUNDS * 3);

    for (let round = 0; round < ROUNDS; round += 1) {
      const product = await admin.post('/marketplace/house/listings', {
        typeClass: 'trading_card',
        description: `Idempotency race ${round}`,
        conditionGrade: 'Raw',
        photoRef: `SN-RACE-${round}`,
        askingPrice: PRICE,
        stock: 3,
      });
      expect(product.status).toBe(201);
      const productId = product.body.id as string;
      const key = `race-${Date.now()}-${round}-${Math.floor(Math.random() * 1e6)}`;

      const before = await balanceOf(buyer);
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          buyer.post(`/marketplace/house/listings/${productId}/purchase`, undefined, { 'Idempotency-Key': key }),
        ),
      );

      // Exactly one execution: one copy gone, one charge.
      const shelf = (await buyer.get('/marketplace/house/listings')).body as Array<{ id: string; stock: number }>;
      expect(shelf.find((l) => l.id === productId)?.stock ?? 0, `round ${round}`).toBe(2);
      expect(await balanceOf(buyer), `round ${round}`).toBe(before - PRICE);

      // Every request is answered with the one order (a replay), or refused —
      // never with a second order and never with a 5xx.
      const orders = new Set(results.filter(ok).map((r) => r.body.orderCode as string));
      expect(orders.size, `round ${round}`).toBe(1);
      for (const r of results) expect(r.status === 201 || r.status === 409, `round ${round}: ${r.status}`).toBe(true);
      expect(results.filter((r) => ok(r) && !r.body.replayed)).toHaveLength(1);
    }
  });

  it('will not hand one buyer the receipt another buyer earned with the same key', async () => {
    const admin = await signIn(SEED.admin);
    const first = await signIn(SEED.collector2);
    const second = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 5_000);
    const product = await admin.post('/marketplace/house/listings', {
      typeClass: 'trading_card',
      description: 'Shared key',
      conditionGrade: 'Raw',
      photoRef: 'SN-RACE-SHARED',
      askingPrice: 1_000,
      stock: 3,
    });
    const key = `shared-${Date.now()}`;
    const url = `/marketplace/house/listings/${product.body.id}/purchase`;
    expect((await first.post(url, undefined, { 'Idempotency-Key': key })).status).toBe(201);

    const before = await balanceOf(second);
    const res = await second.post(url, undefined, { 'Idempotency-Key': key });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('idempotency_key_reused');
    expect(await balanceOf(second)).toBe(before);
  });
});
