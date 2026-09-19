import { describe, it, expect } from 'vitest';
import { SEED, signIn } from '../integration/helpers/http';

/**
 * US4 property (T056, Principle IV): after ANY sequence of money operations, the
 * wallet balance equals the sum of that user's ledger records.
 *
 * The sequence is now driven through the cash-in/cash-out REQUEST workflow,
 * because that is the only way money moves. This makes the property stronger
 * than it was: it asserts not merely that the balance tracks the ledger, but
 * that requests which were never completed contribute NOTHING to either.
 *
 * Requires a running API + seeded DB.
 */
describe('property: wallet balance == Σ ledger', () => {
  it('balance equals Σ ledger after a mixed sequence of completed and undecided requests', async () => {
    const customer = await signIn(SEED.collector);
    const admin = await signIn(SEED.admin);

    const start = (await customer.get('/finance/wallet')).body as { amount: number };
    let expected = start.amount;

    /** Raise a cash-in request. Distinct references keep them distinct requests. */
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

    // A deterministic, awkward set of amounts — nothing round, so an off-by-one
    // in the ledger arithmetic cannot hide behind a tidy total. Every one clears
    // the $10 cash-in minimum, or the request would be refused before it could
    // contribute anything to the sum.
    const completedAmounts = [1_234, 5_000, 7_771, 9_042, 100_000];
    for (const [index, amount] of completedAmounts.entries()) {
      const id = await submit(amount, `complete-${index}`);
      await admin.post(`/admin/wallet-requests/${id}/approve`, {});
      const done = await admin.post(`/admin/wallet-requests/${id}/complete`, {});
      expect(done.status).toBe(201);
      expected += amount;
    }

    // Requests that are approved but NOT completed, rejected, and cancelled.
    // None of these may touch the balance, and the totals below prove it.
    const approvedOnly = await submit(50_000, 'approved-only');
    await admin.post(`/admin/wallet-requests/${approvedOnly}/approve`, {});

    const rejected = await submit(60_000, 'rejected');
    await admin.post(`/admin/wallet-requests/${rejected}/reject`, { reason: 'Property test.' });

    const cancelled = await submit(70_000, 'cancelled');
    await customer.post(`/finance/wallet-requests/${cancelled}/cancel`, {});

    // A cash-out, completed, to exercise the debit direction too.
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
    /**
     * A cash-out costs exactly the amount asked for: the fee comes out of it
     * (a net withdrawal row plus a fee row), as the quote says. It used to cost
     * the gross AND the fee — the collector paid the fee twice.
     */
    const outQuote = (await customer.get('/finance/cash-out-quote?amountMinor=3456')).body as {
      feeMinor: number;
      netMinor: number;
    };
    expect(outQuote.netMinor + outQuote.feeMinor).toBe(3_456);
    expected -= 3_456;

    const balance = (await customer.get('/finance/wallet')).body as { amount: number };
    const ledger = (await customer.get('/finance/ledger')).body as { amount: number; direction: string }[];
    const summed = ledger.reduce((acc, r) => acc + (r.direction === 'credit' ? r.amount : -r.amount), 0);

    expect(balance.amount).toBe(summed); // the balance IS Σ ledger, always
    expect(balance.amount).toBe(expected); // and only completed requests moved it
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

    // Three requests raised, one completed: exactly one new ledger row.
    expect(after.length - before.length).toBe(1);
    expect(after.filter((r) => r.referenceId === completed)).toHaveLength(1);
    expect(after.some((r) => r.referenceId === openOne)).toBe(false);
    expect(after.some((r) => r.referenceId === rejectedOne)).toBe(false);

    await customer.post(`/finance/wallet-requests/${openOne}/cancel`, {});
  });
});
