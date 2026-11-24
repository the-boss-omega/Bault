import { afterAll, describe, expect, it } from 'vitest';
import { BASE, SEED, signIn, type Client } from './helpers/http';
import { closeDb, honouredMembership, sql } from './helpers/db';
import { MFA_PASSWORD, activeAccount, type Account } from './helpers/mfa';

afterAll(closeDb);

interface LedgerRow {
  type: string;
  amount: number;
  direction: string;
  referenceType: string | null;
  referenceId: string | null;
  chargeAction: string | null;
}

const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

async function usage(userId: string) {
  const [row] = await sql<{ actions: number; spent: string }>(
    `SELECT actions, spent_minor::text AS spent FROM usage_tier_counts($1::uuid)`,
    [userId],
  );
  return { actions: row!.actions, spentMinor: Number(row!.spent) };
}

async function freshCollector(label: string): Promise<{ account: Account; collector: Client }> {
  const account = await activeAccount(label);
  return { account, collector: await signIn(account.email, MFA_PASSWORD) };
}

async function cashIn(collector: Client, admin: Client, amountMinor: number): Promise<string> {
  const created = await collector.post('/finance/wallet-requests', {
    type: 'cash_in',
    amountMinor,
    currency: 'USD',
    fundingSource: 'bank_transfer',
    reference: `fee-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  expect((await admin.post(`/admin/wallet-requests/${id}/approve`, {})).status).toBe(201);
  expect((await admin.post(`/admin/wallet-requests/${id}/complete`, {})).status).toBe(201);
  return id;
}

async function approvedCashOut(collector: Client, admin: Client, amountMinor: number, destination: string): Promise<string> {
  const created = await collector.post('/finance/wallet-requests', {
    type: 'cash_out',
    amountMinor,
    currency: 'USD',
    destinationAccount: destination,
    beneficiaryName: 'Fee Tester',
    reference: `fee-out-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  expect((await admin.post(`/admin/wallet-requests/${id}/approve`, {})).status).toBe(201);
  return id;
}

async function feeCharges(requestId: string) {
  return sql<{ action_type: string; status: string; amount: number }>(
    `SELECT action_type, status, amount FROM charge
      WHERE reference_id = $1 AND pricing_rule_snapshot ->> 'cashOutFee' = 'true'`,
    [requestId],
  );
}

async function webhook(event: { id: string; type: string; data: Record<string, unknown> }) {
  const res = await fetch(`${BASE}/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  return res.status;
}

describe('PAY a cash-out fee is its own action and is not use of the platform', () => {
  it('is charged as cash_out_fee, named so on the statement, and leaves the usage tier counts alone', async () => {
    const admin = await signIn(SEED.admin);
    const { account, collector } = await freshCollector('cofee');
    await cashIn(collector, admin, 20_000);
    const before = await usage(account.id);

    const id = await approvedCashOut(collector, admin, 5_000, `${account.username}+payout@example.test`);
    const done = await admin.post(`/admin/wallet-requests/${id}/complete`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.status).toBe('completed');

    const charges = await feeCharges(id);
    expect(charges).toHaveLength(1);
    expect(charges[0]!.action_type).toBe('cash_out_fee');
    expect(charges[0]!.status).toBe('settled');

    const rows = (await collector.get('/finance/ledger')).body as LedgerRow[];
    const fee = rows.find((r) => r.type === 'fee' && r.referenceType === 'charge');
    expect(fee?.chargeAction).toBe('cash_out_fee');

    expect(await usage(account.id)).toEqual(before);
  }, 30_000);

  it('marks the fee refunded when the provider refuses the payout, in the same step as the money going back', async () => {
    const admin = await signIn(SEED.admin);
    const { account, collector } = await freshCollector('corefu');
    await cashIn(collector, admin, 20_000);
    const before = await balanceOf(collector);
    const counted = await usage(account.id);

    const id = await approvedCashOut(collector, admin, 4_000, `${account.username}+payout-refused@example.test`);
    expect((await admin.post(`/admin/wallet-requests/${id}/complete`, {})).status).toBe(409);

    expect(await balanceOf(collector)).toBe(before);
    const charges = await feeCharges(id);
    expect(charges).toHaveLength(1);
    expect(charges[0]!.status).toBe('refunded');
    expect(await usage(account.id)).toEqual(counted);
  }, 30_000);

  it('marks the fee refunded when a paid payout comes back', async () => {
    const admin = await signIn(SEED.admin);
    const { account, collector } = await freshCollector('coback');
    await cashIn(collector, admin, 20_000);
    const before = await balanceOf(collector);
    const counted = await usage(account.id);

    const id = await approvedCashOut(collector, admin, 3_200, `${account.username}+payout-pending@example.test`);
    expect((await admin.post(`/admin/wallet-requests/${id}/complete`, {})).body.status).toBe('paying');
    const d = (await admin.get(`/admin/wallet-requests/${id}`)).body as { payout: { externalRef: string; providerRef: string } };
    const item = { payout_batch_id: d.payout.externalRef, payout_item: { sender_item_id: d.payout.providerRef } };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    expect(await webhook({ id: `WH-${stamp}-paid`, type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', data: { ...item, transaction_status: 'SUCCESS' } })).toBe(201);
    expect((await feeCharges(id))[0]!.status).toBe('settled');
    expect(await webhook({ id: `WH-${stamp}-rev`, type: 'PAYMENT.PAYOUTS-ITEM.RETURNED', data: { ...item, transaction_status: 'RETURNED' } })).toBe(201);

    expect(await balanceOf(collector)).toBe(before);
    const charges = await feeCharges(id);
    expect(charges).toHaveLength(1);
    expect(charges[0]!.status).toBe('refunded');
    expect(await usage(account.id)).toEqual(counted);
  }, 30_000);
});

describe('PAY a chargeback fee is its own action and is not use of the platform', () => {
  it('is charged as chargeback_fee, named so on the statement, and leaves the usage tier counts alone', async () => {
    const admin = await signIn(SEED.admin);
    const { account, collector } = await freshCollector('cbfee');
    const requestId = await cashIn(collector, admin, 10_000);
    const before = await usage(account.id);
    const month = new Date().toISOString().slice(0, 7);
    const chargebackRevenue = async () =>
      ((await admin.get(`/admin/accounting/summary?month=${month}`)).body as { revenue: { lines: { key: string; totalMinor: number }[] } })
        .revenue.lines.find((l) => l.key === 'chargeback_fee')!.totalMinor;
    const revenueBefore = await chargebackRevenue();

    const res = await admin.post(`/finance/chargebacks/wallet-requests/${requestId}`, { reason: 'The bank recalled it.' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.feeMinor).toBeGreaterThan(0);

    const [c] = await sql<{ action_type: string }>(
      `SELECT action_type FROM charge WHERE reference_id = $1 AND pricing_rule_snapshot ->> 'chargebackFee' = 'true'`,
      [requestId],
    );
    expect(c?.action_type).toBe('chargeback_fee');
    const rows = (await collector.get('/finance/ledger')).body as LedgerRow[];
    expect(rows.find((r) => r.type === 'fee' && r.referenceType === 'charge')?.chargeAction).toBe('chargeback_fee');
    expect(await usage(account.id)).toEqual(before);

    expect((await chargebackRevenue()) - revenueBefore).toBe(res.body.feeMinor);
  }, 30_000);
});

describe('PAY a membership waiver on a cash-out fee', () => {
  it('waives the fee twice for a gold period, and gives the allowance back when the provider refuses the second payout', async () => {
    const admin = await signIn(SEED.admin);
    const { account, collector } = await freshCollector('cowaive');
    await cashIn(collector, admin, 30_000);
    const { periodId } = await honouredMembership({ id: account.id }, 'gold');
    const consumed = async () => {
      const [p] = await sql<{ n: number }>(
        `SELECT COALESCE((consumed ->> 'cash_out_fee')::int, 0) AS n FROM membership_period WHERE id = $1`,
        [periodId],
      );
      return p!.n;
    };
    const start = await balanceOf(collector);

    const first = await approvedCashOut(collector, admin, 5_000, `${account.username}+payout@example.test`);
    expect((await admin.post(`/admin/wallet-requests/${first}/complete`, {})).body.status).toBe('completed');
    expect(await feeCharges(first)).toEqual([]);
    expect(await consumed()).toBe(1);
    expect(await balanceOf(collector)).toBe(start - 5_000);

    const second = await approvedCashOut(collector, admin, 6_000, `${account.username}+payout-refused@example.test`);
    expect((await admin.post(`/admin/wallet-requests/${second}/complete`, {})).status).toBe(409);
    expect(await feeCharges(second)).toEqual([]);
    const [paying] = await sql<{ metadata: { waivedMinor: number; waiverPeriodId: string | null } }>(
      `SELECT metadata FROM wallet_request_event WHERE request_id = $1 AND to_status = 'paying'`,
      [second],
    );
    expect(paying!.metadata.waivedMinor).toBeGreaterThan(0);
    expect(paying!.metadata.waiverPeriodId).toBe(periodId);
    expect(await consumed()).toBe(1);
    expect(await balanceOf(collector)).toBe(start - 5_000);

    const third = await approvedCashOut(collector, admin, 4_000, `${account.username}+payout@example.test`);
    expect((await admin.post(`/admin/wallet-requests/${third}/complete`, {})).body.status).toBe('completed');
    expect(await feeCharges(third)).toEqual([]);
    expect(await consumed()).toBe(2);

    const fourth = await approvedCashOut(collector, admin, 3_000, `${account.username}+payout@example.test`);
    expect((await admin.post(`/admin/wallet-requests/${fourth}/complete`, {})).body.status).toBe('completed');
    expect((await feeCharges(fourth))).toHaveLength(1);
    expect(await consumed()).toBe(2);
  }, 60_000);
});
