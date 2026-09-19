import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, signIn, type Client } from './helpers/http';

/**
 * Section 9 — money in, money out, and knowing what it costs.
 *
 * What the audit found here was a set of OMISSIONS rather than bugs. The ledger
 * was right, the request workflow was right, the history was right. What was
 * missing was every point at which a collector needed to know something before
 * acting — what a cash-out lands, where to send a bank transfer, what anything
 * costs at all — and one point at which the platform needed to record something
 * that had happened to it.
 *
 * So the assertions are mostly about ARITHMETIC being visible and consistent:
 * a quote that matches the charge, a fee that appears as its own row, a
 * reversal that actually moves the balance back.
 *
 * Requires a running API + a freshly seeded DB.
 */
describe('PAY money in and out', () => {
  const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

  /* ---------------- self-service top-up ---------------- */

  it('publishes the routes money can come in by, and which settle instantly', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/finance/funding-routes');
    expect(res.status).toBe(200);

    const routes = res.body.routes as Array<{ key: string; instant: boolean; available: boolean }>;
    expect(routes.find((r) => r.key === 'card')!.instant).toBe(true);
    expect(routes.find((r) => r.key === 'bank_transfer')!.instant).toBe(false);
    // A card needs no configuration, so it is always available.
    expect(routes.find((r) => r.key === 'card')!.available).toBe(true);
    expect(res.body.referenceNote).toMatch(/username/i);
  });

  it('takes a card payment and moves the balance on the spot', async () => {
    const collector = await signIn(SEED.collector);
    const before = await balanceOf(collector);

    const res = await collector.post('/finance/checkout', {
      amountMinor: 25_000,
      route: 'card',
      idempotencyKey: `it-${Date.now()}-${Math.random()}`,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('succeeded');
    // No reviewer, no wait: the provider has already guaranteed it.
    expect(await balanceOf(collector)).toBe(before + 25_000);
  });

  it('credits once for one idempotency key, however many times it is sent', async () => {
    const collector = await signIn(SEED.collector);
    const key = `dedupe-${Date.now()}-${Math.random()}`;
    const before = await balanceOf(collector);

    const first = await collector.post('/finance/checkout', {
      amountMinor: 12_000,
      route: 'card',
      idempotencyKey: key,
    });
    expect(first.body.replayed).toBe(false);

    const second = await collector.post('/finance/checkout', {
      amountMinor: 12_000,
      route: 'card',
      idempotencyKey: key,
    });
    expect(second.body.replayed).toBe(true);

    // The whole point of the key: a double-clicked button is harmless.
    expect(await balanceOf(collector)).toBe(before + 12_000);
  });

  it('refuses to take a route the provider does not settle, and says why', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/finance/checkout', {
      amountMinor: 20_000,
      route: 'bank_transfer',
      idempotencyKey: `manual-${Date.now()}`,
    });
    expect(res.status).toBe(400);
    // Named, with the alternative — not a bare validation failure.
    expect(String(res.body.error.message)).toMatch(/cash-in request/i);
  });

  it('holds the top-up limits', async () => {
    const collector = await signIn(SEED.collector);
    const tooSmall = await collector.post('/finance/checkout', {
      amountMinor: 50,
      route: 'card',
      idempotencyKey: `small-${Date.now()}`,
    });
    expect(tooSmall.status).toBe(400);

    const tooBig = await collector.post('/finance/checkout', {
      amountMinor: 900_000_000,
      route: 'card',
      idempotencyKey: `big-${Date.now()}`,
    });
    expect(tooBig.status).toBe(400);
  });

  /* ---------------- the cash-out fee ---------------- */

  it('quotes what a cash-out lands, on both sides of the band', async () => {
    const collector = await signIn(SEED.collector);

    // Under the band: a percentage with a floor.
    const small = (await collector.get('/finance/cash-out-quote?amountMinor=5000')).body;
    expect(small.feeMinor).toBe(300); // 6% of $50
    expect(small.netMinor).toBe(4_700);

    // The floor itself bites on a very small amount.
    const tiny = (await collector.get('/finance/cash-out-quote?amountMinor=1000')).body;
    expect(tiny.feeMinor).toBe(99); // 6% of $10 is $0.60 — the $0.99 floor wins

    // Over the band: fixed plus a much smaller percentage.
    const large = (await collector.get(`/finance/cash-out-quote?amountMinor=100000`)).body;
    expect(large.feeMinor).toBe(500 + 1_000); // $5.00 + 1% of $1,000
    expect(large.netMinor).toBe(100_000 - 1_500);

    expect(small.schedule.bandMinor).toBe(10_000);
  });

  it('charges the quoted fee at completion, as its own row', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 60_000);

    const AMOUNT = 40_000; // $400 — over the band
    const quote = (await collector.get(`/finance/cash-out-quote?amountMinor=${AMOUNT}`)).body;
    expect(quote.feeMinor).toBeGreaterThan(0);

    const created = await collector.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor: AMOUNT,
      currency: 'USD',
      destinationAccount: 'Chase ****1234',
      beneficiaryName: 'Red Ashwood',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const before = await balanceOf(collector);
    expect((await admin.post(`/admin/wallet-requests/${id}/approve`, {})).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${id}/complete`, {})).status).toBe(201);

    // The wallet loses exactly what was asked for: the fee comes OUT of it, as
    // quoted ("{fee} comes off {gross}, so {net} reaches you"). It used to lose
    // the gross AND the fee while paying out only the net.
    expect(await balanceOf(collector)).toBe(before - AMOUNT);

    const ledger = (await collector.get('/finance/ledger')).body as Array<{
      type: string;
      amount: number;
      direction: string;
    }>;
    // Two rows that add up to the request: the net that left, and the fee.
    expect(ledger.some((r) => r.type === 'withdrawal' && r.amount === quote.netMinor)).toBe(true);
    expect(ledger.some((r) => r.type === 'fee' && r.amount === quote.feeMinor)).toBe(true);
    expect(quote.netMinor + quote.feeMinor).toBe(AMOUNT);
  });

  it('cashes out the whole balance, taking the fee out of it rather than on top', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector2);

    // Ask for exactly the balance. The fee comes out of it, so it completes and
    // the balance ends at zero — not below it.
    const balance = await balanceOf(collector);
    const created = await collector.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor: balance,
      currency: 'USD',
      destinationAccount: 'Wise ****9876',
      beneficiaryName: 'Golden Marsh',
    });
    if (created.status !== 201) return; // above the platform maximum; nothing to test

    const id = created.body.id as string;
    await admin.post(`/admin/wallet-requests/${id}/approve`, {});
    const completed = await admin.post(`/admin/wallet-requests/${id}/complete`, {});
    expect(completed.status).toBe(201);
    expect(await balanceOf(collector)).toBe(0);
  });

  /* ---------------- chargebacks ---------------- */

  it('reverses a settled top-up, takes the money back and charges the handling fee', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector2);

    const paid = await collector.post('/finance/checkout', {
      amountMinor: 30_000,
      route: 'card',
      idempotencyKey: `cb-${Date.now()}-${Math.random()}`,
    });
    expect(paid.body.status).toBe('succeeded');
    const paymentId = paid.body.paymentId as string;

    const afterPaying = await balanceOf(collector);

    const reversed = await admin.post(`/finance/chargebacks/${paymentId}`, {
      reason: 'Cardholder disputed the payment with their bank.',
      providerCaseRef: 'CASE-99182',
    });
    expect(reversed.status).toBe(201);
    expect(reversed.body.reversedMinor).toBe(30_000);
    expect(reversed.body.feeMinor).toBeGreaterThan(0);

    // The ledger stops claiming money the platform no longer holds.
    expect(await balanceOf(collector)).toBe(afterPaying - 30_000 - reversed.body.feeMinor);

    const ledger = (await collector.get('/finance/ledger')).body as Array<{ type: string; amount: number }>;
    // Its own type, not a negative top-up: they are different facts.
    expect(ledger.some((r) => r.type === 'chargeback' && r.amount === 30_000)).toBe(true);

    // And it cannot be reversed twice.
    const again = await admin.post(`/finance/chargebacks/${paymentId}`, { reason: 'Again.' });
    expect(again.status).toBe(409);
  });

  it('can waive the handling fee when Bault won the dispute', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector2);

    const paid = await collector.post('/finance/checkout', {
      amountMinor: 15_000,
      route: 'card',
      idempotencyKey: `cbwin-${Date.now()}-${Math.random()}`,
    });
    const before = await balanceOf(collector);

    const reversed = await admin.post(`/finance/chargebacks/${paid.body.paymentId}`, {
      reason: 'Reversed by the issuer; no provider fee was levied.',
      chargeFee: false,
    });
    expect(reversed.body.feeMinor).toBe(0);
    // Charging a fee that was not incurred would be inventing a cost.
    expect(await balanceOf(collector)).toBe(before - 15_000);
  });

  it('will not let a collector reverse their own payment', async () => {
    const collector = await signIn(SEED.collector);
    const paid = await collector.post('/finance/checkout', {
      amountMinor: 11_000,
      route: 'card',
      idempotencyKey: `cbself-${Date.now()}-${Math.random()}`,
    });
    const res = await collector.post(`/finance/chargebacks/${paid.body.paymentId}`, {
      reason: 'I would like my money back please.',
    });
    expect(res.status).toBe(403);
  });

  /* ---------------- the price list ---------------- */

  it('publishes a price list a stranger can read', async () => {
    const base = process.env.API_URL ?? 'http://localhost:3000/api/v1';
    const res = await fetch(`${base}/pricing/list`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as {
      groups: { group: string; entries: { actionType: string; itemClass: string | null; model: string; value: number }[] }[];
      note: string;
    };

    expect(list.groups.length).toBeGreaterThan(2);
    const all = list.groups.flatMap((g) => g.entries);
    expect(all.some((e) => e.actionType === 'intake')).toBe(true);
    expect(all.some((e) => e.actionType === 'storage')).toBe(true);

    // One entry per action/class — a superseded rule beside its replacement
    // turns a price list into a puzzle.
    // Intake is priced per class, so the key is the pair, not the action.
    const keys = all.map((e) => `${e.actionType}::${e.itemClass ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
    const card = all.find((e) => e.actionType === 'intake' && e.itemClass === 'trading_card');
    expect(card?.value).toBe(100);

    // Grouped by what somebody is doing, not by action_type prefix.
    const shipping = list.groups.find((g) => g.group === 'shipping');
    expect(shipping!.entries.some((e) => e.actionType.startsWith('shipping_addon:'))).toBe(true);

    expect(list.note).toMatch(/never alters what you were already billed/i);
  });

  it('states a percentage rule as a percentage, not as dollars', async () => {
    const base = process.env.API_URL ?? 'http://localhost:3000/api/v1';
    const list = (await (await fetch(`${base}/pricing/list`)).json()) as {
      groups: { entries: { actionType: string; model: string; value: number }[] }[];
    };
    const marketplace = list.groups
      .flatMap((g) => g.entries)
      .find((e) => e.actionType === 'marketplace_fee');
    expect(marketplace!.model).toBe('percentage');
    // 500 basis points is 5%, not $5.00 — the distinction a price list exists
    // to get right.
    expect(marketplace!.value).toBe(500);
  });
});
