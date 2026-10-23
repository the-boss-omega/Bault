import { describe, it, expect } from 'vitest';
import { SEED, signIn } from '../integration/helpers/http';

describe('property: wallet balance == Σ ledger', () => {
  it('balance equals Σ ledger after a mixed sequence of completed and undecided requests', async () => {
    const customer = await signIn(SEED.collector);
    const admin = await signIn(SEED.admin);

    const start = (await customer.get('/finance/wallet')).body as { amount: number };
    let expected = start.amount;

    async function submit(amountMinor: number, tag: string): Promise<string> {
      const res = await customer.post('/finance/wallet-requests', {
        type: 'cash_in',
        amountMinor,
        currency: 'USD',
        fundingSource: 'bank_transfer',
        reference: `property-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      });
      expect(res.status).toBe(201);
      return res.body.id as string;
    }

    const completedAmounts = [1_234, 5_000, 7_771, 9_042, 100_000];
    for (const [index, amount] of completedAmounts.entries()) {
      const id = await submit(amount, `complete-${index}`);
      await admin.post(`/admin/wallet-requests/${id}/approve`, {});
      const done = await admin.post(`/admin/wallet-requests/${id}/complete`, {});
      expect(done.status).toBe(201);
      expected += amount;
    }

    const approvedOnly = await submit(50_000, 'approved-only');
    await admin.post(`/admin/wallet-requests/${approvedOnly}/approve`, {});

    const rejected = await submit(60_000, 'rejected');
    await admin.post(`/admin/wallet-requests/${rejected}/reject`, { reason: 'Property test.' });

    const cancelled = await submit(70_000, 'cancelled');
    await customer.post(`/finance/wallet-requests/${cancelled}/cancel`, {});

    const out = await customer.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor: 3_456,
      currency: 'USD',
      destinationAccount: 'IL62 0108 0000 0009 9999 999',
      beneficiaryName: 'Red Ashwood',
      reference: `property-out-${Date.now()}`,
    });
    expect(out.status).toBe(201);
    await admin.post(`/admin/wallet-requests/${out.body.id}/approve`, {});
    await admin.post(`/admin/wallet-requests/${out.body.id}/complete`, {});
    const outQuote = (await customer.get('/finance/cash-out-quote?amountMinor=3456')).body as {
      amountMinor: number;
      feeMinor: number;
      netMinor: number;
    };
    expect(outQuote.netMinor + outQuote.feeMinor).toBe(3_456);
    expected -= outQuote.amountMinor;

    const balance = (await customer.get('/finance/wallet')).body as { amount: number };
    const ledger = (await customer.get('/finance/ledger')).body as { amount: number; direction: string }[];
    const summed = ledger.reduce((acc, r) => acc + (r.direction === 'credit' ? r.amount : -r.amount), 0);

    expect(balance.amount).toBe(summed);
    expect(balance.amount).toBe(expected);
  });

  it('writes exactly one ledger row per completed request, and none for the rest', async () => {
    const customer = await signIn(SEED.collector2);
    const admin = await signIn(SEED.admin);

    const before = (await customer.get('/finance/ledger')).body as unknown[];

    const submit = async (tag: string) => {
      const res = await customer.post('/finance/wallet-requests', {
        type: 'cash_in',
        amountMinor: 4_321,
        currency: 'USD',
        fundingSource: 'card',
        reference: `rowcount-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    const completed = await submit('completed');
    await admin.post(`/admin/wallet-requests/${completed}/approve`, {});
    await admin.post(`/admin/wallet-requests/${completed}/complete`, {});

    const openOne = await submit('open');
    const rejectedOne = await submit('rejected');
    await admin.post(`/admin/wallet-requests/${rejectedOne}/reject`, { reason: 'Property test.' });

    const after = (await customer.get('/finance/ledger')).body as {
      referenceType: string | null;
      referenceId: string | null;
    }[];

    expect(after.length - before.length).toBe(1);
    expect(after.filter((r) => r.referenceId === completed)).toHaveLength(1);
    expect(after.some((r) => r.referenceId === openOne)).toBe(false);
    expect(after.some((r) => r.referenceId === rejectedOne)).toBe(false);

    await customer.post(`/finance/wallet-requests/${openOne}/cancel`, {});
  });
});
