import { describe, it, expect } from 'vitest';
import { SEED, SEED_USERNAME, fundWallet, signIn, type Client } from './helpers/http';

/**
 * The exports an accountant needs (N40).
 *
 * `ledger_record` is a single-entry wallet ledger: a fee comes off a customer
 * and is credited to no account of Bault's, so Bault's revenue existed only as
 * a sum nobody could run, and there was no way to compare the ledger with the
 * money that actually moved through PayPal. No tax logic is attempted here —
 * that is an accountant's call — only the three reports one needs to make it:
 *
 *   - every ledger row in a range, as CSV;
 *   - a month's totals, with Bault's revenue kept apart from customer money in
 *     and out and from the balances Bault holds for customers;
 *   - external payments reconciled against the ledger rows that cite them.
 *
 * Requires a running API + a freshly seeded DB.
 */

type Summary = {
  byType: { type: string; direction: string; totalMinor: number }[];
  revenue: { lines: { key: string; totalMinor: number }[] };
};

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

/** Raise, approve and complete a cash-out for a seeded collector. */
async function cashOut(email: string, amountMinor: number): Promise<string> {
  const customer = await signIn(email);
  const created = await customer.post('/finance/wallet-requests', {
    type: 'cash_out',
    amountMinor,
    currency: 'USD',
    destinationAccount: 'Accounting ****4242',
    beneficiaryName: 'Golden Marsh',
  });
  expect(created.status).toBe(201);
  const admin = await signIn(SEED.admin);
  expect((await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {})).status).toBe(201);
  expect((await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {})).status).toBe(201);
  return created.body.id as string;
}

describe('N40 accounting: who may read it', () => {
  it('is for administrators only', async () => {
    const range = `from=${day(-1)}&to=${day(1)}`;
    for (const email of [SEED.collector, SEED.operator]) {
      const c = await signIn(email);
      expect((await c.getText(`/admin/accounting/ledger.csv?${range}`)).status).toBe(403);
      expect((await c.get(`/admin/accounting/summary?month=${day(0).slice(0, 7)}`)).status).toBe(403);
      expect((await c.get('/admin/accounting/reconciliation')).status).toBe(403);
    }
  });
});

describe('N40 ledger export', () => {
  const HEADER = 'occurred_at,ledger_id,user_id,username,type,direction,amount,currency,reference_type,reference_id';

  it('exports every ledger row in the range, one CSV line each', async () => {
    await fundWallet(SEED.collector2, 1_234);
    const admin = await signIn(SEED.admin);

    const res = await admin.getText(`/admin/accounting/ledger.csv?from=${day(-1)}&to=${day(1)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="bault-ledger-/);

    const lines = res.text.trimEnd().split('\r\n');
    expect(lines[0]).toBe(HEADER);
    const rows = lines.slice(1).map((l) => l.split(','));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toHaveLength(10);

    // The funding just made, as an accountant reads it: decimal dollars, the
    // person by username, and what the money movement points at.
    const funding = rows.find(
      (r) =>
        r[3] === SEED_USERNAME.collector2 &&
        r[4] === 'credit_topup' &&
        r[5] === 'credit' &&
        r[6] === '12.34' &&
        r[8] === 'wallet_request',
    );
    expect(funding, 'the $12.34 cash-in is missing from the export').toBeDefined();
    expect(funding![7]).toBe('USD');
    expect(Date.parse(funding![0]!)).toBeGreaterThan(Date.now() - 2 * 86_400_000);
  });

  it('leaves out rows outside the range', async () => {
    const admin = await signIn(SEED.admin);
    const res = await admin.getText('/admin/accounting/ledger.csv?from=2001-01-01&to=2001-01-31');
    expect(res.status).toBe(200);
    expect(res.text.trimEnd().split('\r\n')).toEqual([HEADER]);
  });

  it('refuses a missing, malformed, inverted or unbounded range', async () => {
    const admin = await signIn(SEED.admin);
    for (const query of [
      '',
      `from=${day(0)}`,
      'from=2026-13-01&to=2026-12-31',
      'from=yesterday&to=today',
      `from=${day(1)}&to=${day(-1)}`,
      // Over a year in one request is a request to hold the whole ledger open.
      'from=2020-01-01&to=2026-01-01',
    ]) {
      const res = await admin.getText(`/admin/accounting/ledger.csv?${query}`);
      expect(res.status, `"${query}" was accepted`).toBe(400);
    }
  });
});

describe('N40 monthly summary', () => {
  it('keeps Bault revenue, customer money and balances held apart', async () => {
    const admin = await signIn(SEED.admin);
    const golden = await signIn(SEED.collector2);
    const month = day(0).slice(0, 7);
    const read = async () => {
      const res = await admin.get(`/admin/accounting/summary?month=${month}`);
      expect(res.status).toBe(200);
      return res.body;
    };
    const total = (s: Summary, type: string, direction: string) =>
      s.byType
        .filter((r) => r.type === type && r.direction === direction)
        .reduce((a, r) => a + r.totalMinor, 0);
    const line = (s: Summary, key: string) =>
      s.revenue.lines.find((l) => l.key === key)?.totalMinor ?? 0;

    const before = await read();
    await fundWallet(SEED.collector2, 50_000);
    const balanceBefore = await balanceOf(golden);
    await cashOut(SEED.collector2, 20_000);
    // Whatever the fee came to — a membership may waive it — it is what left
    // the wallet beyond the amount paid out.
    const fee = balanceBefore - (await balanceOf(golden)) - 20_000;
    const after = await read();

    expect(after.month).toBe(month);
    expect(after.currency).toBe('USD');

    // Totals by ledger type and direction.
    expect(total(after, 'credit_topup', 'credit') - total(before, 'credit_topup', 'credit')).toBe(50_000);
    expect(total(after, 'withdrawal', 'debit') - total(before, 'withdrawal', 'debit')).toBe(20_000);
    expect(total(after, 'fee', 'debit') - total(before, 'fee', 'debit')).toBe(fee);

    // Customer money in and out is not revenue...
    expect(after.customerMoney.inMinor - before.customerMoney.inMinor).toBe(50_000);
    expect(after.customerMoney.outMinor - before.customerMoney.outMinor).toBe(20_000);
    // ...and the cash-out fee is, on its own line.
    expect(line(after, 'cash_out_fee') - line(before, 'cash_out_fee')).toBe(fee);
    expect(after.revenue.totalMinor - before.revenue.totalMinor).toBe(fee);

    // Revenue is exactly the fee, service-charge and interest rows, net.
    const lines = after.revenue.lines as { totalMinor: number }[];
    expect(lines.reduce((a, l) => a + l.totalMinor, 0)).toBe(after.revenue.totalMinor);
    const net = (type: string) => total(after, type, 'debit') - total(after, type, 'credit');
    expect(after.revenue.totalMinor).toBe(net('fee') + net('service_charge') + net('interest'));

    // The balances Bault holds for customers moved by what came in less what
    // went out — the fee is Bault's now, not the customer's.
    expect(after.balancesHeld.customerTotalMinor - before.balancesHeld.customerTotalMinor).toBe(
      50_000 - 20_000 - fee,
    );
    expect(after.balancesHeld.customerTotalMinor).toBe(
      after.balancesHeld.owedToCustomersMinor - after.balancesHeld.owedByCustomersMinor,
    );
  });

  it('reports a month with no activity as zeroes rather than an error', async () => {
    const admin = await signIn(SEED.admin);
    const res = await admin.get('/admin/accounting/summary?month=2001-02');
    expect(res.status).toBe(200);
    expect(res.body.byType).toEqual([]);
    expect(res.body.revenue.totalMinor).toBe(0);
    expect(res.body.customerMoney.inMinor).toBe(0);
    expect(res.body.balancesHeld.customerTotalMinor).toBe(0);
  });

  it('refuses a month that is not YYYY-MM', async () => {
    const admin = await signIn(SEED.admin);
    for (const month of ['', '2026-13', '2026-1', 'october', '2026-10-01']) {
      const res = await admin.get(`/admin/accounting/summary?month=${month}`);
      expect(res.status, `"${month}" was accepted`).toBe(400);
    }
  });
});

describe('N40 reconciliation: external payments against the ledger', () => {
  type Mismatch = {
    kind: string;
    paymentId: string | null;
    ledgerId: string | null;
    walletRequestId: string | null;
    username: string | null;
    expectedMinor: number | null;
    recordedMinor: number | null;
  };
  const reconcile = async (admin: Client) => {
    const res = await admin.get('/admin/accounting/reconciliation');
    expect(res.status).toBe(200);
    return res.body as { checked: Record<string, number>; matched: number; mismatches: Mismatch[] };
  };

  it('matches a settled card payment to exactly one credit, and keeps it matched after a chargeback', async () => {
    const admin = await signIn(SEED.admin);
    const golden = await signIn(SEED.collector2);
    const paid = await golden.post('/finance/checkout', {
      amountMinor: 7_700,
      route: 'card',
      idempotencyKey: `recon-${Date.now()}-${Math.random()}`,
    });
    expect(paid.body.status).toBe('succeeded');
    const paymentId = paid.body.paymentId as string;

    const first = await reconcile(admin);
    expect(first.checked.topups).toBeGreaterThan(0);
    expect(first.mismatches.filter((m) => m.paymentId === paymentId)).toEqual([]);

    expect(
      (await admin.post(`/finance/chargebacks/${paymentId}`, { reason: 'Reconciliation fixture.' })).status,
    ).toBe(201);
    const second = await reconcile(admin);
    expect(second.mismatches.filter((m) => m.paymentId === paymentId)).toEqual([]);
    expect(second.matched).toBeGreaterThan(0);
  });

  it('matches a completed cash-out to the payout that paid it', async () => {
    const admin = await signIn(SEED.admin);
    await fundWallet(SEED.collector2, 30_000);
    const requestId = await cashOut(SEED.collector2, 15_000);

    const report = await reconcile(admin);
    expect(report.checked.payouts).toBeGreaterThan(0);
    expect(report.mismatches.filter((m) => m.walletRequestId === requestId)).toEqual([]);
  });

  it('reports money that left a wallet with no payout behind it', async () => {
    // The seed carries one: Golden's $1,000 withdrawal from before cash-out was
    // a reviewed request, written to the ledger by a path that never recorded a
    // payment at any provider. On a live system that is precisely the row an
    // accountant must be shown — a debit nobody can match to money that moved.
    const admin = await signIn(SEED.admin);
    const report = await reconcile(admin);
    const found = report.mismatches.find(
      (m) =>
        m.kind === 'withdrawal_without_payout' &&
        m.username === SEED_USERNAME.collector2 &&
        m.recordedMinor === 100_000,
    );
    expect(found, JSON.stringify(report.mismatches.slice(0, 5))).toBeDefined();
    expect(found!.ledgerId).toBeTruthy();
    expect(found!.paymentId).toBeNull();
  });
});
