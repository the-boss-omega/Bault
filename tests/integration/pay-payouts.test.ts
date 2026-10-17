import { describe, it, expect } from 'vitest';
import { BASE, SEED, fundWallet, signIn, type Client } from './helpers/http';

/**
 * A cash-out leaves Bault. These are the tests for the moment it does.
 *
 * Four ways a payout can lose money, each pinned here:
 *
 *   - the provider is paid the amount less the fee, so the ledger must debit
 *     the amount once (net plus fee), never the amount AND the fee;
 *   - a failure after the provider paid must not roll back the debit, or cash
 *     leaves with no debit behind it;
 *   - the provider is called outside the transaction that debits the wallet, so
 *     a hung provider holds neither a pool connection nor the wallet lock;
 *   - a payout PayPal has only ACCEPTED stays pending until it settles or
 *     bounces, so one that later fails does not leave the collector debited for
 *     money that never arrived.
 *
 * The sandbox provider takes instructions from the destination, so each case
 * here can be staged without a real provider: `+payout-slow`, `+payout-lost`,
 * `+payout-pending`, `+payout-settles`, `+payout-bounces`, `+payout-refused`.
 *
 * Requires a running API (in the default `provider` payout mode) and a seeded DB.
 */

interface Payout {
  id: string;
  status: string;
  amount: number;
  providerRef: string;
  externalRef: string | null;
  webhookEventId: string | null;
}

interface RequestDetail {
  id: string;
  status: string;
  amount: number;
  payoutReference: string | null;
  payout: Payout | null;
}

interface LedgerRow {
  type: string;
  amount: number;
  direction: string;
  referenceType: string | null;
  referenceId: string | null;
}

const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

/** Raise and approve a cash-out of `amount` to `destination`, after funding enough to cover it. */
async function approvedCashOut(email: string, amount: number, destination: string) {
  await fundWallet(email, amount + 1_000);
  const collector = await signIn(email);
  const created = await collector.post('/finance/wallet-requests', {
    type: 'cash_out',
    amountMinor: amount,
    currency: 'USD',
    destinationAccount: destination,
    beneficiaryName: 'Golden Marsh',
    reference: `payout-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  });
  expect(created.status).toBe(201);
  const admin = await signIn(SEED.admin);
  expect((await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {})).status).toBe(201);
  return { collector, admin, id: created.body.id as string };
}

async function detail(admin: Client, id: string): Promise<RequestDetail> {
  const res = await admin.get(`/admin/wallet-requests/${id}`);
  expect(res.status).toBe(200);
  return res.body as RequestDetail;
}

/** The ledger rows that name this request. */
async function ledgerFor(collector: Client, requestId: string): Promise<LedgerRow[]> {
  const rows = (await collector.get('/finance/ledger')).body as LedgerRow[];
  return rows.filter((r) => r.referenceId === requestId);
}

async function webhook(event: { id: string; type: string; data: Record<string, unknown> }) {
  const res = await fetch(`${BASE}/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  return res.status;
}

describe('PAY a cash-out debits exactly what was quoted (F004)', () => {
  it('pays the provider the net, and debits the collector the gross and nothing more', async () => {
    const AMOUNT = 40_000; // $400, over the fee band
    const { collector, admin, id } = await approvedCashOut(SEED.collector2, AMOUNT, 'golden@example.test');
    const quote = (await collector.get(`/finance/cash-out-quote?amountMinor=${AMOUNT}`)).body as {
      amountMinor: number;
      feeMinor: number;
      netMinor: number;
    };
    expect(quote.feeMinor).toBeGreaterThan(0);
    expect(quote.netMinor).toBe(AMOUNT - quote.feeMinor);

    const before = await balanceOf(collector);
    const done = await admin.post(`/admin/wallet-requests/${id}/complete`, {});
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('completed');

    // What the collector was told: they ask for $400, $400 leaves the wallet.
    expect(await balanceOf(collector)).toBe(before - quote.amountMinor);

    // What the provider was asked to send is what the quote said would land.
    const d = await detail(admin, id);
    expect(d.payout).not.toBeNull();
    expect(d.payout!.amount).toBe(quote.netMinor);
    expect(d.payout!.status).toBe('succeeded');

    // Both numbers are on the statement, and together they are the quote.
    const all = (await collector.get('/finance/ledger')).body as LedgerRow[];
    const withdrawal = all.find((r) => r.type === 'withdrawal' && r.referenceId === id);
    expect(withdrawal?.amount).toBe(quote.netMinor);
    const fee = all.find((r) => r.type === 'fee' && r.direction === 'debit' && r.amount === quote.feeMinor);
    expect(fee).toBeTruthy();
    expect(withdrawal!.amount + fee!.amount).toBe(quote.amountMinor);
  }, 30_000);
});

describe('PAY the payout is recorded before the provider is asked (F172, N6)', () => {
  it('commits the debit and a pending payment first, and holds no lock while the provider thinks', async () => {
    const AMOUNT = 5_000;
    const { collector, admin, id } = await approvedCashOut(
      SEED.collector2,
      AMOUNT,
      'golden+payout-slow@example.test',
    );
    const before = await balanceOf(collector);

    let payoutDone = false;
    const completing = admin.post(`/admin/wallet-requests/${id}/complete`, {}).then((r) => {
      payoutDone = true;
      return r;
    });

    // While the provider is still answering, the request already says money is
    // on its way, and the wallet already shows it gone.
    let seen: RequestDetail | null = null;
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const d = await detail(admin, id);
      if (d.status === 'paying') {
        seen = d;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(seen?.status).toBe('paying');
    expect(seen?.payout?.status).toBe('pending');
    expect(await balanceOf(collector)).toBe(before - AMOUNT);

    // And nothing is locked: another movement on the same wallet goes through
    // while the provider is still on the line.
    await fundWallet(SEED.collector2, 1_234);
    expect(payoutDone).toBe(false);

    const res = await completing;
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('completed');
    expect(await balanceOf(collector)).toBe(before - AMOUNT + 1_234);
    // The staged provider takes three seconds on purpose; the default five is too tight.
  }, 30_000);

  it('keeps the debit when the answer is lost, refuses to reject it, and reconciles it', async () => {
    const AMOUNT = 6_000;
    const { collector, admin, id } = await approvedCashOut(
      SEED.collector2,
      AMOUNT,
      'golden+payout-lost@example.test',
    );
    const before = await balanceOf(collector);

    // The provider took it and the connection dropped. The money may well have
    // gone, so the debit stays and the payment stays pending, to be found again.
    const res = await admin.post(`/admin/wallet-requests/${id}/complete`, {});
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('provider_unavailable');
    expect(await balanceOf(collector)).toBe(before - AMOUNT);
    const d = await detail(admin, id);
    expect(d.status).toBe('paying');
    expect(d.payout?.status).toBe('pending');

    // Rejecting it now would invite paying it again by hand.
    const reject = await admin.post(`/admin/wallet-requests/${id}/reject`, { reason: 'Looks stuck.' });
    expect(reject.status).toBe(409);
    expect((await admin.post(`/admin/wallet-requests/${id}/complete`, {})).status).toBe(409);

    // Reconciliation asks again, with the same key, and records what happened.
    const reconciled = await admin.post('/admin/payouts/reconcile', { olderThanMinutes: 0 });
    expect(reconciled.status).toBe(201);
    const after = await detail(admin, id);
    expect(after.status).toBe('completed');
    expect(after.payout?.status).toBe('succeeded');
    // One debit, not two.
    expect(await balanceOf(collector)).toBe(before - AMOUNT);
  }, 30_000);

  it('gives the money back when the provider refuses the payout', async () => {
    const AMOUNT = 4_000;
    const { collector, admin, id } = await approvedCashOut(
      SEED.collector2,
      AMOUNT,
      'golden+payout-refused@example.test',
    );
    const before = await balanceOf(collector);

    const res = await admin.post(`/admin/wallet-requests/${id}/complete`, {});
    expect(res.status).toBe(409);

    const d = await detail(admin, id);
    expect(d.status).toBe('payout_failed');
    expect(d.payout?.status).toBe('failed');
    expect(await balanceOf(collector)).toBe(before);

    // Put back by a compensating row, never by editing the debit.
    const rows = await ledgerFor(collector, id);
    expect(rows.some((r) => r.type === 'withdrawal' && r.direction === 'debit')).toBe(true);
    expect(rows.some((r) => r.type === 'payout_reversal' && r.direction === 'credit' && r.amount === AMOUNT)).toBe(true);
  }, 30_000);
});

describe('PAY a pending payout is not a completed one (F029, F040)', () => {
  it('waits for the provider, and completes when the provider says it landed', async () => {
    const AMOUNT = 3_000;
    const { collector, admin, id } = await approvedCashOut(
      SEED.collector2,
      AMOUNT,
      'golden+payout-pending@example.test',
    );
    const before = await balanceOf(collector);

    const res = await admin.post(`/admin/wallet-requests/${id}/complete`, {});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('paying');
    expect(await balanceOf(collector)).toBe(before - AMOUNT);

    const d = await detail(admin, id);
    expect(d.payout?.status).toBe('pending');
    expect(d.payout?.externalRef).toBeTruthy();

    const eventId = `WH-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const event = {
      id: eventId,
      type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
      data: {
        payout_batch_id: d.payout!.externalRef,
        transaction_status: 'SUCCESS',
        payout_item: { sender_item_id: d.payout!.providerRef },
      },
    };
    expect(await webhook(event)).toBe(201);

    const after = await detail(admin, id);
    expect(after.status).toBe('completed');
    expect(after.payout?.status).toBe('succeeded');
    expect(after.payout?.webhookEventId).toBe(eventId);

    // A redelivery changes nothing.
    expect(await webhook(event)).toBe(201);
    expect(await balanceOf(collector)).toBe(before - AMOUNT);
  }, 30_000);

  it('reverses the debit once when the provider later says the payout failed', async () => {
    const AMOUNT = 3_500;
    const { collector, admin, id } = await approvedCashOut(
      SEED.collector2,
      AMOUNT,
      'golden+payout-pending@example.test',
    );
    const before = await balanceOf(collector);
    await admin.post(`/admin/wallet-requests/${id}/complete`, {});
    const d = await detail(admin, id);
    expect(d.status).toBe('paying');

    const failed = {
      id: `WH-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      type: 'PAYMENT.PAYOUTS-ITEM.RETURNED',
      data: {
        payout_batch_id: d.payout!.externalRef,
        transaction_status: 'RETURNED',
        payout_item: { sender_item_id: d.payout!.providerRef },
      },
    };
    expect(await webhook(failed)).toBe(201);
    const after = await detail(admin, id);
    expect(after.status).toBe('payout_failed');
    expect(after.payout?.status).toBe('failed');
    expect(await balanceOf(collector)).toBe(before);

    // The same event again, and a second failure event for the same payout:
    // still one reversal.
    expect(await webhook(failed)).toBe(201);
    expect(await webhook({ ...failed, id: `${failed.id}-again`, type: 'PAYMENT.PAYOUTS-ITEM.FAILED' })).toBe(201);
    expect(await balanceOf(collector)).toBe(before);
    const reversals = (await ledgerFor(collector, id)).filter((r) => r.type === 'payout_reversal');
    expect(reversals).toHaveLength(1);
    expect(reversals[0]!.amount).toBe(AMOUNT);
  }, 30_000);

  it('reconciles stale pending payouts by asking the provider again', async () => {
    const admin = await signIn(SEED.admin);
    const settles = await approvedCashOut(SEED.collector2, 2_500, 'golden+payout-settles@example.test');
    const bounces = await approvedCashOut(SEED.collector2, 2_600, 'golden+payout-bounces@example.test');
    const stuck = await approvedCashOut(SEED.collector2, 2_700, 'golden+payout-pending@example.test');
    const collector = settles.collector;

    for (const r of [settles, bounces, stuck]) {
      const res = await admin.post(`/admin/wallet-requests/${r.id}/complete`, {});
      expect(res.body.status).toBe('paying');
    }
    const before = await balanceOf(collector);

    // Only an administrator may run it.
    expect((await collector.post('/admin/payouts/reconcile', { olderThanMinutes: 0 })).status).toBe(403);

    const res = await admin.post('/admin/payouts/reconcile', { olderThanMinutes: 0 });
    expect(res.status).toBe(201);
    expect(res.body.checked).toBeGreaterThanOrEqual(3);

    expect((await detail(admin, settles.id)).status).toBe('completed');
    expect((await detail(admin, bounces.id)).status).toBe('payout_failed');
    expect((await detail(admin, stuck.id)).status).toBe('paying');
    // Only the bounced one came back.
    expect(await balanceOf(collector)).toBe(before + 2_600);
  }, 30_000);
});
