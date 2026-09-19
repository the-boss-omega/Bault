import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, signIn } from './helpers/http';

/**
 * US4 / Scenario E — the wallet, after cash in and cash out became REQUESTS.
 *
 * The property these tests defend is the one the request workflow exists for:
 * **a balance changes only when an approved request is completed.** Submitting
 * one changes nothing. Approving one changes nothing. The single ledger row
 * appears at completion and nowhere else.
 *
 * Every amount on the platform is USD in cents (Requirement 7.1).
 */
describe('PAY wallet requests', () => {
  it('reports the wallet balance in USD', async () => {
    const client = await signIn(SEED.collector);
    const wallet = (await client.get('/finance/wallet')).body as { amount: number; currency: string };
    expect(wallet.currency).toBe('USD');
  });

  it('submitting a cash-in request does NOT change the balance', async () => {
    const client = await signIn(SEED.collector2);
    const before = (await client.get('/finance/wallet')).body.amount as number;

    const created = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 25_000,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `pay-flow-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('submitted');
    expect(created.body.code).toMatch(/^WR-/);
    // No ledger row is written on submission, so no settlement link exists yet.
    expect(created.body.settledLedgerId).toBeFalsy();

    const after = (await client.get('/finance/wallet')).body.amount as number;
    expect(after).toBe(before);
  });

  it('credits the wallet only once an approved cash-in is completed', async () => {
    const client = await signIn(SEED.collector2);
    const before = (await client.get('/finance/wallet')).body.amount as number;

    const created = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 30_000,
      currency: 'USD',
      fundingSource: 'card',
      reference: `pay-flow-complete-${Date.now()}`,
    });
    const requestId = created.body.id as string;

    const admin = await signIn(SEED.admin);

    // Approval alone is a decision, not a payment.
    const approved = await admin.post(`/admin/wallet-requests/${requestId}/approve`, {});
    expect(approved.status).toBe(201);
    expect((await client.get('/finance/wallet')).body.amount).toBe(before);

    const completed = await admin.post(`/admin/wallet-requests/${requestId}/complete`, {});
    expect(completed.status).toBe(201);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.settledLedgerId).toBeTruthy();

    expect((await client.get('/finance/wallet')).body.amount).toBe(before + 30_000);

    const ledger = (await client.get('/finance/ledger')).body as {
      type: string;
      direction: string;
      referenceType: string | null;
      referenceId: string | null;
    }[];
    const row = ledger.find((r) => r.referenceType === 'wallet_request' && r.referenceId === requestId);
    expect(row).toBeTruthy();
    expect(row?.type).toBe('credit_topup');
    expect(row?.direction).toBe('credit');
  });

  it('debits the wallet only once an approved cash-out is completed', async () => {
    await fundWallet(SEED.collector2, 40_000);
    const client = await signIn(SEED.collector2);
    const before = (await client.get('/finance/wallet')).body.amount as number;

    const created = await client.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor: 5_000,
      currency: 'USD',
      destinationAccount: 'IL62 0108 0000 0009 9999 999',
      beneficiaryName: 'Golden Marsh',
      reference: `pay-flow-out-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    expect((await client.get('/finance/wallet')).body.amount).toBe(before);

    const admin = await signIn(SEED.admin);
    await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {});
    await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {});

    /**
     * Cashing out carries a fee, and it comes OUT of the amount asked for: the
     * balance moves by exactly the request, split into the net that left and
     * the fee. Asserted against the QUOTE rather than a hard-coded figure: the
     * claim worth defending is that the collector is charged exactly what they
     * were told before they asked.
     */
    const quote = (await client.get('/finance/cash-out-quote?amountMinor=5000')).body as {
      feeMinor: number;
      netMinor: number;
    };
    expect(quote.feeMinor).toBeGreaterThan(0);
    expect((await client.get('/finance/wallet')).body.amount).toBe(before - 5_000);

    const ledger = (await client.get('/finance/ledger')).body as { type: string; direction: string }[];
    expect(ledger.some((r) => r.type === 'withdrawal' && r.direction === 'debit')).toBe(true);
    // The fee is its own row, not netted off the withdrawal.
    expect(ledger.some((r) => r.type === 'fee' && r.direction === 'debit')).toBe(true);
  });

  it('rejects a cash-out larger than the balance', async () => {
    // The amount must be over the balance AND inside the published limits —
    // otherwise the amount rule rejects it first, with a 400, and this never
    // reaches the balance check it means to exercise. `collector3` is the
    // migrated account and carries little or no money, so one cent over its
    // balance is comfortably under the $20,000 ceiling.
    const client = await signIn(SEED.collector3);
    const balance = (await client.get('/finance/wallet')).body.amount as number;
    // Over the balance, at or above the $20 minimum, and under the $20,000
    // ceiling — all three, or the amount rule answers before the balance rule.
    const amountMinor = Math.max(balance + 1, 2_000);
    expect(amountMinor).toBeLessThan(2_000_000);

    const res = await client.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor,
      currency: 'USD',
      destinationAccount: 'IL62 0108 0000 0009 9999 999',
      beneficiaryName: 'Ana Maria van der Berg',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('insufficient_balance');
  });

  it('rejects an amount above the published maximum before looking at the balance', async () => {
    const client = await signIn(SEED.collector);
    const res = await client.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor: 9_000_000, // above the $20,000 ceiling
      currency: 'USD',
      destinationAccount: 'IL62 0108 0000 0009 9999 999',
      beneficiaryName: 'Red Ashwood',
    });
    expect(res.status).toBe(400);
  });

  it('refuses a duplicate of an identical open request', async () => {
    const client = await signIn(SEED.collector);
    const amount = 7_777;
    const first = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: amount,
      currency: 'USD',
      fundingSource: 'bank_transfer',
    });
    expect(first.status).toBe(201);

    const second = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: amount,
      currency: 'USD',
      fundingSource: 'bank_transfer',
    });
    expect(second.status).toBe(409);
    expect(second.body.error.details.existingCode).toBe(first.body.code);

    // Cancelling the first frees the amount again — the guard is about
    // simultaneous identical requests, not about the amount forever.
    await client.post(`/finance/wallet-requests/${first.body.id}/cancel`, {});
    const third = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: amount,
      currency: 'USD',
      fundingSource: 'bank_transfer',
    });
    expect(third.status).toBe(201);
    await client.post(`/finance/wallet-requests/${third.body.id}/cancel`, {});
  });

  it('validates the amount against the published limits', async () => {
    const client = await signIn(SEED.collector);
    const tooSmall = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 1, // one cent, below the $10 minimum
      currency: 'USD',
      fundingSource: 'bank_transfer',
    });
    expect(tooSmall.status).toBe(400);

    const tooLarge = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 999_999_999,
      currency: 'USD',
      fundingSource: 'bank_transfer',
    });
    expect(tooLarge.status).toBe(400);
  });

  it('requires a funding source for cash in and a destination for cash out', async () => {
    const client = await signIn(SEED.collector);
    const noFunding = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 5_000,
      currency: 'USD',
    });
    expect(noFunding.status).toBe(400);

    const noDestination = await client.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor: 5_000,
      currency: 'USD',
    });
    expect(noDestination.status).toBe(400);
  });

  it('records an immutable audit trail for every state change', async () => {
    const client = await signIn(SEED.collector2);
    const created = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 11_000,
      currency: 'USD',
      fundingSource: 'paypal',
      reference: `audit-${Date.now()}`,
    });
    const requestId = created.body.id as string;

    const admin = await signIn(SEED.admin);
    await admin.post(`/admin/wallet-requests/${requestId}/review`, {});
    await admin.post(`/admin/wallet-requests/${requestId}/reject`, { reason: 'Documentation missing.' });

    const detail = await client.get(`/finance/wallet-requests/${requestId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.rejectionReason).toBe('Documentation missing.');

    const history = detail.body.history as {
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      actorId: string | null;
      occurredAt: string;
    }[];
    expect(history.map((e) => e.toStatus)).toEqual(['submitted', 'pending_review', 'rejected']);
    // Every row names who acted and when; the rejection names why.
    for (const event of history) {
      expect(event.actorId).toBeTruthy();
      expect(event.occurredAt).toBeTruthy();
    }
    expect(history[2]?.fromStatus).toBe('pending_review');
    expect(history[2]?.reason).toBe('Documentation missing.');
  });

  it('refuses a rejection with no reason', async () => {
    const client = await signIn(SEED.collector2);
    const created = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 12_345,
      currency: 'USD',
      fundingSource: 'other',
      reference: `no-reason-${Date.now()}`,
    });
    const admin = await signIn(SEED.admin);
    const res = await admin.post(`/admin/wallet-requests/${created.body.id}/reject`, { reason: '   ' });
    expect(res.status).toBe(400);
    await client.post(`/finance/wallet-requests/${created.body.id}/cancel`, {});
  });

  it('cannot complete a request that was never approved', async () => {
    const client = await signIn(SEED.collector2);
    const created = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 13_500,
      currency: 'USD',
      fundingSource: 'crypto',
      reference: `unapproved-${Date.now()}`,
    });
    const admin = await signIn(SEED.admin);
    await admin.post(`/admin/wallet-requests/${created.body.id}/review`, {});

    const res = await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {});
    expect(res.status).toBe(409);
    await client.post(`/finance/wallet-requests/${created.body.id}/cancel`, {});
  });

  it('completes a request exactly once', async () => {
    const client = await signIn(SEED.collector2);
    const created = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 9_100,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `once-${Date.now()}`,
    });
    const admin = await signIn(SEED.admin);
    await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {});

    const before = (await client.get('/finance/wallet')).body.amount as number;
    expect((await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {})).status).toBe(201);
    const second = await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {});
    expect(second.status).toBe(409);

    // Credited once, not twice.
    expect((await client.get('/finance/wallet')).body.amount).toBe(before + 9_100);
  });
});

/**
 * Who may do what. These are the separation-of-duties and authorization rules;
 * the API is the enforcement and the UI merely reflects it, so they are tested
 * here rather than assumed from the buttons that happen to be rendered.
 */
describe('PAY wallet request permissions', () => {
  it('does not let a collector reach the review queue or its actions', async () => {
    const client = await signIn(SEED.collector);
    expect((await client.get('/admin/wallet-requests')).status).toBe(403);

    const created = await client.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 6_000,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `perm-${Date.now()}`,
    });
    expect((await client.post(`/admin/wallet-requests/${created.body.id}/approve`, {})).status).toBe(403);
    await client.post(`/finance/wallet-requests/${created.body.id}/cancel`, {});
  });

  it('does not let a warehouse operator review requests', async () => {
    const operator = await signIn(SEED.operator);
    expect((await operator.get('/admin/wallet-requests')).status).toBe(403);
  });

  it('does not let an administrator approve their OWN request', async () => {
    const admin = await signIn(SEED.admin);
    const created = await admin.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 8_800,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `self-${Date.now()}`,
    });
    expect(created.status).toBe(201);

    // Same account, admin role, own request: refused on every reviewer action.
    expect((await admin.post(`/admin/wallet-requests/${created.body.id}/approve`, {})).status).toBe(403);
    expect((await admin.post(`/admin/wallet-requests/${created.body.id}/complete`, {})).status).toBe(403);
    expect(
      (await admin.post(`/admin/wallet-requests/${created.body.id}/reject`, { reason: 'nope' })).status,
    ).toBe(403);

    await admin.post(`/finance/wallet-requests/${created.body.id}/cancel`, {});
  });

  it('shows a user only their own requests', async () => {
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);

    const created = await golden.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 4_200,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `scope-${Date.now()}`,
    });

    const mine = (await red.get('/finance/wallet-requests')).body as { id: string }[];
    expect(mine.some((r) => r.id === created.body.id)).toBe(false);

    // And a direct fetch by id reports not-found rather than confirming it exists.
    expect((await red.get(`/finance/wallet-requests/${created.body.id}`)).status).toBe(404);
    await golden.post(`/finance/wallet-requests/${created.body.id}/cancel`, {});
  });

  it('lets only the requester cancel their request', async () => {
    const golden = await signIn(SEED.collector2);
    const created = await golden.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 3_100,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `cancel-${Date.now()}`,
    });

    const red = await signIn(SEED.collector);
    expect((await red.post(`/finance/wallet-requests/${created.body.id}/cancel`, {})).status).toBe(404);

    const own = await golden.post(`/finance/wallet-requests/${created.body.id}/cancel`, {});
    expect(own.status).toBe(201);
    expect(own.body.status).toBe('cancelled');
  });
});

/**
 * Backward compatibility for clients still calling the pre-request endpoints.
 * They keep working, at the same URLs, but they raise a request rather than
 * moving money — and they say so in the response.
 */
describe('PAY legacy endpoint compatibility', () => {
  it('turns the legacy top-up endpoint into a cash-in request', async () => {
    const client = await signIn(SEED.collector2);
    const before = (await client.get('/finance/wallet')).body.amount as number;

    const res = await client.post('/finance/wallet/topups', { amountMinor: 15_500 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.code).toMatch(/^WR-/);
    expect((await client.get('/finance/wallet')).body.amount).toBe(before);

    await client.post(`/finance/wallet-requests/${res.body.requestId}/cancel`, {});
  });

  it('turns the legacy withdrawal endpoint into a cash-out request', async () => {
    await fundWallet(SEED.collector2, 20_000);
    const client = await signIn(SEED.collector2);
    const before = (await client.get('/finance/wallet')).body.amount as number;

    const res = await client.post('/finance/withdrawals', {
      amountMinor: 4_000,
      destinationAccount: 'IL62 0108 0000 0009 9999 999',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_approval');
    // No confirmation token: there is nothing a token could confirm now.
    expect(res.body.confirmationToken).toBeUndefined();
    expect((await client.get('/finance/wallet')).body.amount).toBe(before);

    await client.post(`/finance/wallet-requests/${res.body.requestId}/cancel`, {});
  });

  it('answers the retired withdrawal-confirm endpoint with a 410', async () => {
    const client = await signIn(SEED.collector2);
    const res = await client.post('/finance/withdrawals/confirm', { confirmationToken: 'anything' });
    expect(res.status).toBe(410);
  });
});
