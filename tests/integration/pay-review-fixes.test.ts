import { afterAll, describe, expect, it } from 'vitest';
import { BASE, SEED, fundWallet, signIn, type Client } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

const key = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

async function cashInRequest(c: Client, amountMinor: number, fundingSource = 'bank_transfer') {
  const res = await c.post('/finance/wallet-requests', {
    type: 'cash_in',
    amountMinor,
    currency: 'USD',
    fundingSource,
    reference: key('rv'),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function webhook(event: { id: string; type: string; data: Record<string, unknown> }) {
  const res = await fetch(`${BASE}/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  return res.status;
}

describe('PAY separation of duties does not read the path text', () => {
  it('refuses an administrator their own request whether its id is written in lower or upper case', async () => {
    const admin = await signIn(SEED.admin);
    const id = await cashInRequest(admin, 1_500);
    for (const written of [id, id.toUpperCase()]) {
      for (const action of ['review', 'approve', 'complete']) {
        const res = await admin.post(`/admin/wallet-requests/${written}/${action}`, {});
        expect(res.status, `${action} ${written}`).toBe(403);
      }
      const rejected = await admin.post(`/admin/wallet-requests/${written}/reject`, { reason: 'Mine.' });
      expect(rejected.status).toBe(403);
    }
    const [row] = await sql<{ status: string }>(`SELECT status FROM wallet_request WHERE id = $1`, [id]);
    expect(row!.status).toBe('submitted');
    expect((await admin.post(`/finance/wallet-requests/${id.toUpperCase()}/cancel`, {})).status).toBe(201);
  });

  it('refuses a request id that is not a uuid as a bad request, never as a server error', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector);
    const answers = [
      await admin.get('/admin/wallet-requests/not-a-uuid'),
      await admin.post('/admin/wallet-requests/not-a-uuid/approve', {}),
      await admin.post('/admin/wallet-requests/not-a-uuid/complete', {}),
      await collector.get('/finance/wallet-requests/not-a-uuid'),
      await collector.post('/finance/wallet-requests/not-a-uuid/cancel', {}),
      await admin.post('/finance/chargebacks/wallet-requests/not-a-uuid', { reason: 'x' }),
    ];
    expect(answers.map((r) => r.status)).toEqual([400, 400, 400, 400, 400, 400]);
  });
});

describe('PAY the sandbox direct top-up refuses a key reused for another amount', () => {
  it('answers IDEMPOTENCY_KEY_REUSED, as PayPal and crypto checkout do, and replays the same amount', async () => {
    const collector = await signIn(SEED.collector);
    const idempotencyKey = key('direct');
    const first = await collector.post('/finance/checkout', { amountMinor: 1_000, route: 'card', idempotencyKey });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await collector.post('/finance/checkout', { amountMinor: 1_000, route: 'card', idempotencyKey });
    expect(again.body.replayed).toBe(true);
    const other = await collector.post('/finance/checkout', { amountMinor: 5_000, route: 'card', idempotencyKey });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('idempotency_key_reused');
  });
});

describe('PAY the cash-out quote checks what it is given', () => {
  it('refuses an amount that is not a positive whole number of cents, and says when an amount is outside the limits', async () => {
    const collector = await signIn(SEED.collector);
    for (const bad of ['abc', '-500', '0', '12.5', '']) {
      expect((await collector.get(`/finance/cash-out-quote?amountMinor=${bad}`)).status, bad).toBe(400);
    }
    expect((await collector.get('/finance/cash-out-quote')).status).toBe(400);
    const small = (await collector.get('/finance/cash-out-quote?amountMinor=1000')).body;
    expect(small.withinLimits).toBe(false);
    expect(small.limits).toEqual({ minMinor: 2_000, maxMinor: 2_000_000 });
    expect((await collector.get('/finance/cash-out-quote?amountMinor=5000')).body.withinLimits).toBe(true);
    expect((await collector.get('/finance/cash-out-quote?amountMinor=2000001')).body.withinLimits).toBe(false);
  });
});

describe('PAY wallet request refusals are written for a person', () => {
  it('names limits in dollars and the funding routes in words', async () => {
    const collector = await signIn(SEED.collector);
    const small = await collector.post('/finance/wallet-requests', { type: 'cash_in', amountMinor: 500, fundingSource: 'bank_transfer' });
    expect(small.status).toBe(400);
    expect(small.body.error.message).toBe('The smallest cash-in is $10.00.');
    const large = await collector.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor: 3_000_000,
      destinationAccount: 'red@example.test',
      beneficiaryName: 'Red Fox',
    });
    expect(large.body.error.message).toBe('The largest cash-out is $20000.00.');
    const legacy = await collector.post('/finance/wallet/topups', { amountMinor: 500 });
    expect(legacy.body.error.message).toBe('The smallest cash-in is $10.00.');
    expect(JSON.stringify(legacy.body)).not.toMatch(/cents|bank_transfer/);
  });

  it('says why a closed request cannot be completed, and asks for approval only when that is the way on', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector);
    const rejected = await cashInRequest(collector, 1_600);
    expect((await admin.post(`/admin/wallet-requests/${rejected}/reject`, { reason: 'Never arrived.' })).status).toBe(201);
    const late = await admin.post(`/admin/wallet-requests/${rejected}/complete`, {});
    expect(late.status).toBe(409);
    expect(late.body.error.message).toBe('This request was rejected, so it cannot be completed.');

    const cancelled = await cashInRequest(collector, 1_700);
    expect((await collector.post(`/finance/wallet-requests/${cancelled}/cancel`, {})).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${cancelled}/complete`, {})).body.error.message).toBe(
      'This request was cancelled, so it cannot be completed.',
    );
    expect(late.body.error.message).not.toMatch(/approve/i);
  });
});

describe('PAY the legacy cash-out route', () => {
  it('refuses a destination longer than the current route allows, and writes nothing into the collector’s notes', async () => {
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 5_000);
    const long = await collector.post('/finance/withdrawals', { amountMinor: 2_500, destinationAccount: 'x'.repeat(10_000) });
    expect(long.status).toBe(400);
    const ok = await collector.post('/finance/withdrawals', { amountMinor: 2_500, destinationAccount: `red+${Date.now()}@example.test` });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const mine = (await collector.get(`/finance/wallet-requests/${ok.body.requestId}`)).body;
    expect(mine.notes).toBeNull();
    const [audit] = await sql<{ metadata: { origin?: string } }>(
      `SELECT metadata FROM audit_record WHERE action = 'wallet_request.submit' AND target_id = $1`,
      [ok.body.requestId],
    );
    expect(audit!.metadata.origin).toBe('legacy POST /finance/withdrawals');
    expect((await collector.post(`/finance/wallet-requests/${ok.body.requestId}/cancel`, {})).status).toBe(201);
  });
});

describe('PAY the review queue', () => {
  it('includes the whole of a date-only end day, and pages newest first with limit and before', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector2);
    const ids = [await cashInRequest(collector, 1_101), await cashInRequest(collector, 1_102), await cashInRequest(collector, 1_103)];
    const today = new Date().toISOString().slice(0, 10);

    const byDay = (await admin.get(`/admin/wallet-requests?from=${today}&to=${today}`)).body as { id: string }[];
    for (const id of ids) expect(byDay.some((r) => r.id === id)).toBe(true);

    const first = (await admin.get('/admin/wallet-requests?limit=2')).body as { id: string }[];
    expect(first).toHaveLength(2);
    const second = (await admin.get(`/admin/wallet-requests?limit=2&before=${first[1]!.id}`)).body as { id: string }[];
    expect(second.length).toBeGreaterThan(0);
    expect(second.some((r) => first.some((f) => f.id === r.id))).toBe(false);
    const both = (await admin.get('/admin/wallet-requests?limit=4')).body as { id: string }[];
    expect([...first, ...second].map((r) => r.id)).toEqual(both.slice(0, first.length + second.length).map((r) => r.id));

    expect((await admin.get('/admin/wallet-requests?limit=0')).status).toBe(400);
    expect((await admin.get('/admin/wallet-requests?limit=501')).status).toBe(400);
    expect((await admin.get('/admin/wallet-requests?before=not-an-id')).status).toBe(400);
    for (const id of ids) await collector.post(`/finance/wallet-requests/${id}/cancel`, {});
  });
});

describe('PAY a cash-in taken back names how it was paid', () => {
  it('sends the request’s own funding source to the notification', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector);
    const id = await cashInRequest(collector, 1_800, 'paypal');
    expect((await admin.post(`/admin/wallet-requests/${id}/approve`, {})).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${id}/complete`, {})).status).toBe(201);
    const res = await admin.post(`/finance/chargebacks/wallet-requests/${id}`, { reason: 'PayPal reversed it.', chargeFee: false });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [row] = await sql<{ payload: { kind: string } }>(
      `SELECT payload FROM outbox_message WHERE event_type = 'payment_reversed' AND aggregate_id = $1`,
      [id],
    );
    expect(row!.payload.kind).toBe('paypal');
  });
});

describe('PAY a payout returned after it was paid, as the collector reads it', () => {
  it('says the payout came back, not that it could not be sent', async () => {
    await fundWallet(SEED.collector2, 4_000);
    const collector = await signIn(SEED.collector2);
    const admin = await signIn(SEED.admin);
    const created = await collector.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor: 2_400,
      destinationAccount: 'golden+payout-pending@example.test',
      beneficiaryName: 'Golden Marsh',
      reference: key('ret'),
    });
    const id = created.body.id as string;
    expect((await admin.post(`/admin/wallet-requests/${id}/approve`, {})).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${id}/complete`, {})).body.status).toBe('paying');
    const d = (await admin.get(`/admin/wallet-requests/${id}`)).body as { payout: { externalRef: string; providerRef: string } };
    const item = { payout_batch_id: d.payout.externalRef, payout_item: { sender_item_id: d.payout.providerRef } };
    const stamp = key('WH');
    expect(await webhook({ id: `${stamp}-paid`, type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', data: { ...item, transaction_status: 'SUCCESS' } })).toBe(201);
    expect(await webhook({ id: `${stamp}-back`, type: 'PAYMENT.PAYOUTS-ITEM.RETURNED', data: { ...item, transaction_status: 'RETURNED' } })).toBe(201);

    const mine = (await collector.get(`/finance/wallet-requests/${id}`)).body as { status: string; history: { toStatus: string; reason: string | null }[] };
    expect(mine.status).toBe('payout_failed');
    expect(mine.history.find((h) => h.toStatus === 'payout_failed')?.reason).toBe(
      'The payout was returned after it was sent, and the money is back in your wallet.',
    );
    const [row] = await sql<{ payload: { afterPaid: boolean } }>(
      `SELECT payload FROM outbox_message WHERE event_type = 'wallet_request_payout_failed' AND aggregate_id = $1`,
      [id],
    );
    expect(row!.payload.afterPaid).toBe(true);
  }, 30_000);
});

describe('PAY the statement order', () => {
  it('keeps the rows of one moment in the same order on every read', async () => {
    const collector = await signIn(SEED.collector);
    const reads = await Promise.all([0, 1, 2].map(() => collector.get('/finance/ledger')));
    const orders = reads.map((r) => (r.body as { id: string }[]).map((row) => row.id).join(','));
    expect(new Set(orders).size).toBe(1);
  });
});
