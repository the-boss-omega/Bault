import { createHash } from 'node:crypto';
import { afterAll, describe, it, expect } from 'vitest';
import { BASE, SEED, signIn, type Client } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

// The sandbox payment adapter stands in for PayPal: an order is approved the moment it exists, and the
// cents of the amount choose what the capture does (SANDBOX_CHECKOUT_CENTS in @bault/adapters).
const DECLINED = 91;
const PENDING = 92;
const SHORT = 93;
const NOT_APPROVED = 94;
const LOST = 95;

/** The id the sandbox gives the capture of an order, as PayPal names it in the capture's answer and its webhook. */
const sandboxCaptureId = (orderId: string) => `SBXC-${createHash('sha256').update(orderId).digest('hex').slice(0, 20)}`;

interface Started {
  paymentId: string;
  orderId: string;
  approveUrl: string;
  status: string;
  amountMinor: number;
  replayed: boolean;
}

const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;
const key = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

async function start(c: Client, amountMinor: number, route = 'card', idempotencyKey = key('ck')) {
  const res = await c.post('/finance/checkout/paypal', { amountMinor, route, idempotencyKey });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Started;
}

const capture = (c: Client, paymentId: string) => c.post(`/finance/checkout/paypal/${paymentId}/capture`, {});

async function webhook(event: { id: string; type: string; data: Record<string, unknown> }) {
  const res = await fetch(`${BASE}/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as { outcome?: string } | null };
}

function captureEvent(type: string, started: Started, over: { amount?: string; captureId?: string; fee?: string } = {}) {
  return {
    id: key('WH'),
    type,
    data: {
      id: over.captureId ?? sandboxCaptureId(started.orderId),
      status: type.split('.').pop(),
      amount: { currency_code: 'USD', value: over.amount ?? (started.amountMinor / 100).toFixed(2) },
      custom_id: started.paymentId,
      seller_receivable_breakdown: { paypal_fee: { currency_code: 'USD', value: over.fee ?? '1.23' } },
      supplementary_data: { related_ids: { order_id: started.orderId } },
    },
  };
}

async function credits(paymentId: string) {
  const [row] = await sql<{ n: number; total: string }>(
    `SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::text AS total
       FROM ledger_record
      WHERE type = 'credit_topup' AND reference_type = 'external_payment' AND reference_id = $1`,
    [paymentId],
  );
  return { count: row!.n, totalMinor: Number(row!.total) };
}

async function payment(paymentId: string) {
  const [row] = await sql<{
    status: string;
    provider: string;
    external_ref: string | null;
    capture_ref: string | null;
    provider_fee_minor: string | null;
    webhook_event_id: string | null;
  }>(
    `SELECT status, provider, external_ref, capture_ref, provider_fee_minor::text, webhook_event_id
       FROM external_payment WHERE id = $1`,
    [paymentId],
  );
  return row!;
}

const settledEvents = async (paymentId: string) =>
  (
    await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_message WHERE event_type = 'topup_settled' AND aggregate_id = $1`,
      [paymentId],
    )
  )[0]!.n;

describe('PAY cash-in by PayPal checkout: starting it', () => {
  it('creates an order for the amount chosen, sends the payer to approve it, and credits nothing yet', async () => {
    const collector = await signIn(SEED.collector);
    const before = await balanceOf(collector);

    const started = await start(collector, 5_000);
    expect(started.status).toBe('pending');
    expect(started.amountMinor).toBe(5_000);
    expect(started.replayed).toBe(false);
    expect(started.orderId).toBeTruthy();

    const approve = new URL(started.approveUrl);
    expect(approve.searchParams.get('paypal')).toBe('approved');
    expect(approve.searchParams.get('payment')).toBe(started.paymentId);
    expect(approve.searchParams.get('token')).toBe(started.orderId);

    const row = await payment(started.paymentId);
    expect(row.status).toBe('pending');
    expect(row.external_ref).toBe(started.orderId);
    expect(await credits(started.paymentId)).toEqual({ count: 0, totalMinor: 0 });
    expect(await balanceOf(collector)).toBe(before);
  });

  it('gives back the same checkout for the same key, and refuses the key for another amount', async () => {
    const collector = await signIn(SEED.collector);
    const k = key('same');
    const first = await start(collector, 6_000, 'paypal_gs', k);
    const again = await start(collector, 6_000, 'paypal_gs', k);
    expect(again.paymentId).toBe(first.paymentId);
    expect(again.orderId).toBe(first.orderId);
    expect(again.replayed).toBe(true);

    const other = await collector.post('/finance/checkout/paypal', { amountMinor: 7_000, route: 'paypal_gs', idempotencyKey: k });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('idempotency_key_reused');
  });

  it('holds the cash-in limits, and takes only the routes PayPal settles', async () => {
    const collector = await signIn(SEED.collector);
    const routes = (await collector.get('/finance/funding-routes')).body as { limits: { minMinor: number; maxMinor: number } };

    const tooSmall = await collector.post('/finance/checkout/paypal', {
      amountMinor: routes.limits.minMinor - 1,
      route: 'card',
      idempotencyKey: key('small'),
    });
    expect(tooSmall.status).toBe(400);
    const tooBig = await collector.post('/finance/checkout/paypal', {
      amountMinor: routes.limits.maxMinor + 1,
      route: 'card',
      idempotencyKey: key('big'),
    });
    expect(tooBig.status).toBe(400);
    const bank = await collector.post('/finance/checkout/paypal', { amountMinor: 5_000, route: 'bank_transfer', idempotencyKey: key('bank') });
    expect(bank.status).toBe(400);
    expect(String(bank.body.error.message)).toMatch(/cash-in request/i);
  });
});

describe('PAY cash-in by PayPal checkout: crediting it exactly once', () => {
  it('credits the full amount once when the collector comes back and the capture completes', async () => {
    const collector = await signIn(SEED.collector);
    const before = await balanceOf(collector);
    const started = await start(collector, 12_000);

    const done = await capture(collector, started.paymentId);
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body).toMatchObject({ paymentId: started.paymentId, status: 'succeeded', amountMinor: 12_000, replayed: false });
    expect(await balanceOf(collector)).toBe(before + 12_000);

    const again = await capture(collector, started.paymentId);
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ status: 'succeeded', replayed: true });
    expect(await balanceOf(collector)).toBe(before + 12_000);

    expect(await credits(started.paymentId)).toEqual({ count: 1, totalMinor: 12_000 });
    expect(await settledEvents(started.paymentId)).toBe(1);
    const row = await payment(started.paymentId);
    expect(row.status).toBe('succeeded');
    expect(row.capture_ref).toBeTruthy();
    expect(Number(row.provider_fee_minor)).toBeGreaterThan(0);
  });

  it('credits once when the webhook arrives first, and the capture after it finds the money already in', async () => {
    const collector = await signIn(SEED.collector2);
    const before = await balanceOf(collector);
    const started = await start(collector, 8_000);

    const event = captureEvent('PAYMENT.CAPTURE.COMPLETED', started);
    const hook = await webhook(event);
    expect(hook.status).toBe(201);
    expect(hook.body?.outcome).toBe('applied');
    expect(await balanceOf(collector)).toBe(before + 8_000);
    const row = await payment(started.paymentId);
    expect(row.webhook_event_id).toBe(event.id);
    expect(row.provider_fee_minor).toBe('123');

    const done = await capture(collector, started.paymentId);
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ status: 'succeeded', replayed: true });
    expect(await balanceOf(collector)).toBe(before + 8_000);
    expect(await credits(started.paymentId)).toEqual({ count: 1, totalMinor: 8_000 });
  });

  it('credits once however many times PayPal says so, under the same event id or a new one', async () => {
    const collector = await signIn(SEED.collector2);
    const before = await balanceOf(collector);
    const started = await start(collector, 9_000);
    expect((await capture(collector, started.paymentId)).status).toBe(201);

    const event = captureEvent('PAYMENT.CAPTURE.COMPLETED', started);
    expect((await webhook(event)).status).toBe(201);
    expect((await webhook(event)).body?.outcome).toBe('duplicate');
    expect((await webhook({ ...event, id: key('WH-again') })).status).toBe(201);

    expect(await balanceOf(collector)).toBe(before + 9_000);
    expect(await credits(started.paymentId)).toEqual({ count: 1, totalMinor: 9_000 });
    expect(await settledEvents(started.paymentId)).toBe(1);
  });

  it('captures on PayPal\'s approval when the collector never comes back', async () => {
    const collector = await signIn(SEED.collector3);
    const before = await balanceOf(collector);
    const started = await start(collector, 4_500);

    const approved = await webhook({
      id: key('WH-approved'),
      type: 'CHECKOUT.ORDER.APPROVED',
      data: { id: started.orderId, status: 'APPROVED', purchase_units: [{ custom_id: started.paymentId }] },
    });
    expect(approved.status).toBe(201);
    expect(approved.body?.outcome).toBe('applied');
    expect(await balanceOf(collector)).toBe(before + 4_500);

    expect((await capture(collector, started.paymentId)).body).toMatchObject({ status: 'succeeded', replayed: true });
    expect(await credits(started.paymentId)).toEqual({ count: 1, totalMinor: 4_500 });
  });

  it('answers 502 when PayPal\'s answer is lost, and credits once when the collector tries again', async () => {
    const collector = await signIn(SEED.collector3);
    const before = await balanceOf(collector);
    const started = await start(collector, 3_000 + LOST);

    const lost = await capture(collector, started.paymentId);
    expect(lost.status).toBe(502);
    expect(lost.body.error.code).toBe('provider_unavailable');
    expect(String(lost.body.error.message)).toMatch(/nothing has been credited yet/i);
    expect((await payment(started.paymentId)).status).toBe('pending');
    expect(await balanceOf(collector)).toBe(before);

    const retried = await capture(collector, started.paymentId);
    expect(retried.status).toBe(201);
    expect(retried.body.status).toBe('succeeded');
    expect(await balanceOf(collector)).toBe(before + 3_000 + LOST);
    expect(await credits(started.paymentId)).toEqual({ count: 1, totalMinor: 3_000 + LOST });
  });
});

describe('PAY cash-in by PayPal checkout: what credits nothing', () => {
  it('holds a pending capture without crediting, and credits it when PayPal completes it', async () => {
    const collector = await signIn(SEED.collector);
    const before = await balanceOf(collector);
    const started = await start(collector, 6_000 + PENDING);

    const held = await capture(collector, started.paymentId);
    expect(held.status).toBe(201);
    expect(held.body.status).toBe('pending');
    expect(String(held.body.message)).toMatch(/PayPal/);
    expect(await balanceOf(collector)).toBe(before);
    const row = await payment(started.paymentId);
    expect(row.status).toBe('pending');
    expect(row.capture_ref).toBeTruthy();

    expect(row.capture_ref).toBe(sandboxCaptureId(started.orderId));
    const completed = captureEvent('PAYMENT.CAPTURE.COMPLETED', started);
    expect((await webhook(completed)).body?.outcome).toBe('applied');
    expect(await balanceOf(collector)).toBe(before + 6_000 + PENDING);
    expect(await credits(started.paymentId)).toEqual({ count: 1, totalMinor: 6_000 + PENDING });
  });

  it('credits nothing for a declined capture, and says so', async () => {
    const collector = await signIn(SEED.collector);
    const before = await balanceOf(collector);
    const started = await start(collector, 6_000 + DECLINED);

    const declined = await capture(collector, started.paymentId);
    expect(declined.status).toBe(409);
    expect(String(declined.body.error.message)).toMatch(/declined/i);
    expect(String(declined.body.error.message)).toMatch(/nothing/i);
    expect((await payment(started.paymentId)).status).toBe('failed');

    const again = await capture(collector, started.paymentId);
    expect(again.status).toBe(409);
    expect(await balanceOf(collector)).toBe(before);
    expect(await credits(started.paymentId)).toEqual({ count: 0, totalMinor: 0 });
  });

  it('credits nothing for a capture PayPal denies after holding it', async () => {
    const collector = await signIn(SEED.collector2);
    const before = await balanceOf(collector);
    const started = await start(collector, 5_000 + PENDING);
    expect((await capture(collector, started.paymentId)).body.status).toBe('pending');

    expect((await webhook(captureEvent('PAYMENT.CAPTURE.DENIED', started))).body?.outcome).toBe('applied');
    expect((await payment(started.paymentId)).status).toBe('failed');
    const after = await capture(collector, started.paymentId);
    expect(after.status).toBe(409);
    expect(await balanceOf(collector)).toBe(before);
    expect(await credits(started.paymentId)).toEqual({ count: 0, totalMinor: 0 });
  });

  it('credits nothing when PayPal settles a different amount, whichever way it hears of it', async () => {
    const collector = await signIn(SEED.collector2);
    const before = await balanceOf(collector);
    const short = await start(collector, 5_000 + SHORT);
    const refused = await capture(collector, short.paymentId);
    expect(refused.status).toBe(409);
    expect(String(refused.body.error.message)).toMatch(/nothing has been credited/i);
    expect((await payment(short.paymentId)).status).toBe('refused');
    expect((await webhook(captureEvent('PAYMENT.CAPTURE.COMPLETED', short))).status).toBe(201);
    expect(await credits(short.paymentId)).toEqual({ count: 0, totalMinor: 0 });

    const other = await start(collector, 5_000 + PENDING);
    expect((await capture(collector, other.paymentId)).body.status).toBe('pending');
    const wrong = captureEvent('PAYMENT.CAPTURE.COMPLETED', other, { amount: '1.00' });
    expect((await webhook(wrong)).status).toBe(201);
    expect((await payment(other.paymentId)).status).toBe('refused');
    expect(await credits(other.paymentId)).toEqual({ count: 0, totalMinor: 0 });
    expect(await balanceOf(collector)).toBe(before);
  });

  it('says when PayPal has not approved the payment yet, and keeps it open', async () => {
    const collector = await signIn(SEED.collector3);
    const started = await start(collector, 5_000 + NOT_APPROVED);
    const res = await capture(collector, started.paymentId);
    expect(res.status).toBe(409);
    expect(String(res.body.error.message)).toMatch(/not approved/i);
    expect((await payment(started.paymentId)).status).toBe('pending');
  });

  it('records a checkout the collector left at PayPal as cancelled, and will not capture it after', async () => {
    const collector = await signIn(SEED.collector3);
    const before = await balanceOf(collector);
    const started = await start(collector, 5_500);

    const cancelled = await collector.post(`/finance/checkout/paypal/${started.paymentId}/cancel`, {});
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.status).toBe('cancelled');
    expect((await payment(started.paymentId)).status).toBe('cancelled');

    expect((await capture(collector, started.paymentId)).status).toBe(409);
    expect(await balanceOf(collector)).toBe(before);
  });

  it('still credits a capture PayPal completed for a checkout marked cancelled, because the money arrived', async () => {
    const collector = await signIn(SEED.collector3);
    const before = await balanceOf(collector);
    const started = await start(collector, 5_600);
    expect((await collector.post(`/finance/checkout/paypal/${started.paymentId}/cancel`, {})).status).toBe(201);

    expect((await webhook(captureEvent('PAYMENT.CAPTURE.COMPLETED', started))).body?.outcome).toBe('applied');
    expect((await payment(started.paymentId)).status).toBe('succeeded');
    expect(await balanceOf(collector)).toBe(before + 5_600);
  });

  it('will not let another collector capture or cancel it', async () => {
    const owner = await signIn(SEED.collector);
    const stranger = await signIn(SEED.collector2);
    const started = await start(owner, 5_000);
    expect((await capture(stranger, started.paymentId)).status).toBe(404);
    expect((await stranger.post(`/finance/checkout/paypal/${started.paymentId}/cancel`, {})).status).toBe(404);
    expect((await payment(started.paymentId)).status).toBe('pending');
  });

  it('leaves a capture taken back after it was credited to an administrator, and changes nothing', async () => {
    const collector = await signIn(SEED.collector);
    const started = await start(collector, 7_000);
    expect((await capture(collector, started.paymentId)).body.status).toBe('succeeded');
    const credited = await balanceOf(collector);

    const reversed = await webhook(captureEvent('PAYMENT.CAPTURE.REVERSED', started));
    expect(reversed.status).toBe(201);
    expect(reversed.body?.outcome).toBe('ignored');
    expect(await balanceOf(collector)).toBe(credited);
    expect((await payment(started.paymentId)).status).toBe('succeeded');

    const admin = await signIn(SEED.admin);
    const reversible = (await admin.get('/finance/chargebacks/reversible')).body as { id: string }[];
    expect(reversible.some((p) => p.id === started.paymentId)).toBe(true);
  });

  it('takes a reversal quietly once an administrator has recorded the chargeback', async () => {
    const collector = await signIn(SEED.collector);
    const admin = await signIn(SEED.admin);
    const started = await start(collector, 6_000);
    expect((await capture(collector, started.paymentId)).body.status).toBe('succeeded');
    const recorded = await admin.post(`/finance/chargebacks/${started.paymentId}`, { reason: 'PayPal dispute lost.', chargeFee: false });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
    const after = await balanceOf(collector);

    const reversed = await webhook(captureEvent('PAYMENT.CAPTURE.REVERSED', started));
    expect(reversed.status).toBe(201);
    expect(reversed.body?.outcome).toBe('duplicate');
    const refunded = await webhook(captureEvent('PAYMENT.CAPTURE.REFUNDED', started));
    expect(refunded.body?.outcome).toBe('duplicate');
    expect(await balanceOf(collector)).toBe(after);
    expect((await payment(started.paymentId)).status).toBe('reversed');
  });
});

describe('PAY cash-in by PayPal checkout: the books', () => {
  it('counts the full amount as customer money in, and PayPal\'s fee as Bault\'s cost', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector);
    const month = new Date().toISOString().slice(0, 7);
    const summary = async () => (await admin.get(`/admin/accounting/summary?month=${month}`)).body;

    const before = await summary();
    const started = await start(collector, 20_000);
    expect((await capture(collector, started.paymentId)).body.status).toBe('succeeded');
    const fee = Number((await payment(started.paymentId)).provider_fee_minor);
    expect(fee).toBeGreaterThan(0);

    const after = await summary();
    expect(after.customerMoney.inMinor - before.customerMoney.inMinor).toBe(20_000);
    expect(after.revenue.cashInProviderFeesMinor - before.revenue.cashInProviderFeesMinor).toBe(fee);
    expect(after.revenue.totalMinor).toBe(before.revenue.totalMinor);
  });

  it('leaves reconciliation nothing to flag, and lists the payment that is still open', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector2);
    const credited = await start(collector, 4_000);
    expect((await capture(collector, credited.paymentId)).body.status).toBe('succeeded');
    const open = await start(collector, 4_100);

    const report = (await admin.get('/admin/accounting/reconciliation')).body as {
      mismatches: { paymentId: string | null }[];
      pending: { paymentId: string }[];
    };
    expect(report.mismatches.filter((m) => m.paymentId === credited.paymentId || m.paymentId === open.paymentId)).toEqual([]);
    expect(report.pending.some((p) => p.paymentId === open.paymentId)).toBe(true);
  });
});
