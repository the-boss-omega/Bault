import { describe, it, expect } from 'vitest';
import {
  reconcile,
  type PayoutFacts,
  type TopupFacts,
  type WithdrawalFacts,
} from '../../apps/api/src/modules/adm/reconciliation';

/**
 * The reconciliation rules, one fact pattern at a time.
 *
 * The integration suite proves the report against a live database, but the
 * live API cannot be made to produce most of the faults it exists to find (a
 * payment the provider took with no credit behind it, a credit minted for a
 * payment that failed), because the code refuses to create them. So the rules
 * are pinned here, on the pure function the service feeds, where every pattern
 * can be written down.
 */

const AT = '2026-10-15T12:00:00.000Z';

function topup(over: Partial<TopupFacts> = {}): TopupFacts {
  return {
    id: 'pay-1',
    userId: 'u-1',
    username: 'red',
    provider: 'card',
    status: 'succeeded',
    amount: 10_000,
    createdAt: AT,
    creditCount: 1,
    creditSum: 10_000,
    chargebackCount: 0,
    chargebackSum: 0,
    otherCount: 0,
    ...over,
  };
}

function payout(over: Partial<PayoutFacts> = {}): PayoutFacts {
  return {
    id: 'po-1',
    userId: 'u-1',
    username: 'red',
    status: 'succeeded',
    amount: 19_300,
    providerRef: 'sbx_payout_wallet_request:wr-1',
    createdAt: AT,
    ...over,
  };
}

function withdrawal(over: Partial<WithdrawalFacts> = {}): WithdrawalFacts {
  return {
    ledgerId: 'l-1',
    userId: 'u-1',
    username: 'red',
    amount: 20_000,
    occurredAt: AT,
    walletRequestId: 'wr-1',
    payoutRef: 'sbx_payout_wallet_request:wr-1',
    feeMinor: 700,
    debitedMinor: 20_000,
    reversedMinor: 0,
    ...over,
  };
}

const run = (input: Partial<Parameters<typeof reconcile>[0]>) =>
  reconcile({ topups: [], payouts: [], withdrawals: [], orphans: [], ...input });
const kinds = (r: ReturnType<typeof reconcile>) => r.mismatches.map((m) => m.kind);

describe('money in', () => {
  it('matches a succeeded payment credited once for its amount', () => {
    const r = run({ topups: [topup()] });
    expect(r.mismatches).toEqual([]);
    expect(r.matched).toBe(1);
  });

  it('reports a payment the provider took that no wallet was credited for', () => {
    const r = run({ topups: [topup({ creditCount: 0, creditSum: 0 })] });
    expect(kinds(r)).toEqual(['succeeded_without_credit']);
    expect(r.mismatches[0]).toMatchObject({ paymentId: 'pay-1', expectedMinor: 10_000, recordedMinor: 0 });
    expect(r.matched).toBe(0);
  });

  it('reports a payment credited twice, and one credited the wrong amount', () => {
    expect(kinds(run({ topups: [topup({ creditCount: 2, creditSum: 20_000 })] }))).toEqual(['duplicate_credit']);
    expect(kinds(run({ topups: [topup({ creditSum: 1_000_000 })] }))).toEqual(['credit_amount_mismatch']);
  });

  it('reports a credit for a payment that never settled — store credit from nothing', () => {
    for (const status of ['failed', 'refused', 'pending']) {
      const r = run({ topups: [topup({ status })] });
      expect(kinds(r), status).toEqual(['credit_without_settled_payment']);
    }
  });

  it('matches a failed payment that credited nothing', () => {
    const r = run({ topups: [topup({ status: 'failed', creditCount: 0, creditSum: 0 })] });
    expect(r.mismatches).toEqual([]);
    expect(r.matched).toBe(1);
  });

  it('lists a pending payment with nothing credited as unresolved, not as matched', () => {
    const r = run({ topups: [topup({ status: 'pending', creditCount: 0, creditSum: 0 })] });
    expect(r.mismatches).toEqual([]);
    expect(r.pending.map((p) => p.paymentId)).toEqual(['pay-1']);
    expect(r.matched).toBe(0);
  });

  it('needs a reversed payment to carry both its credit and its chargeback', () => {
    const reversed = topup({ status: 'reversed', chargebackCount: 1, chargebackSum: 10_000 });
    expect(run({ topups: [reversed] }).mismatches).toEqual([]);
    expect(kinds(run({ topups: [{ ...reversed, chargebackCount: 0, chargebackSum: 0 }] }))).toEqual([
      'reversed_without_chargeback',
    ]);
    expect(kinds(run({ topups: [{ ...reversed, chargebackSum: 5_000 }] }))).toEqual(['chargeback_amount_mismatch']);
    expect(kinds(run({ topups: [topup({ chargebackCount: 1, chargebackSum: 10_000 })] }))).toEqual([
      'chargeback_without_reversal',
    ]);
  });

  it('reports a ledger row citing a payment that does not exist', () => {
    const r = run({
      orphans: [
        {
          ledgerId: 'l-9',
          userId: 'u-1',
          username: 'red',
          type: 'credit_topup',
          direction: 'credit',
          amount: 5_000,
          referenceId: 'gone',
          occurredAt: AT,
        },
      ],
    });
    expect(kinds(r)).toEqual(['ledger_references_missing_payment']);
    expect(r.mismatches[0]).toMatchObject({ ledgerId: 'l-9', paymentId: 'gone', recordedMinor: 5_000 });
  });
});

describe('money out', () => {
  it('matches a payout to the debit that recorded it, net of the fee', () => {
    const r = run({ payouts: [payout()], withdrawals: [withdrawal()] });
    expect(r.mismatches).toEqual([]);
    expect(r.matched).toBe(1);
  });

  it('reports a debit with no payout behind it', () => {
    const r = run({ withdrawals: [withdrawal({ walletRequestId: null, payoutRef: null, feeMinor: 0 })] });
    expect(kinds(r)).toEqual(['withdrawal_without_payout']);
    expect(r.mismatches[0]).toMatchObject({ ledgerId: 'l-1', paymentId: null, recordedMinor: 20_000 });
  });

  it('reports a payout with no debit behind it', () => {
    const r = run({ payouts: [payout()] });
    expect(kinds(r)).toEqual(['payout_without_withdrawal']);
  });

  it('never lets one account’s debit vouch for another account’s payout', () => {
    const r = run({ payouts: [payout({ userId: 'u-2' })], withdrawals: [withdrawal()] });
    expect(kinds(r).sort()).toEqual(['payout_without_withdrawal', 'withdrawal_without_payout']);
  });

  it('reports a payout for the wrong amount, and one that failed after the wallet was debited', () => {
    expect(kinds(run({ payouts: [payout({ amount: 20_000 })], withdrawals: [withdrawal()] }))).toEqual([
      'payout_amount_mismatch',
    ]);
    expect(kinds(run({ payouts: [payout({ status: 'failed' })], withdrawals: [withdrawal()] }))).toEqual([
      'payout_failed_but_debited',
    ]);
  });

  it('matches a refused payout whose debit was credited back in full', () => {
    // Older shape: the fee inside the withdrawal row.
    const r = run({ payouts: [payout({ status: 'failed' })], withdrawals: [withdrawal({ reversedMinor: 20_000 })] });
    expect(r.mismatches).toEqual([]);
    expect(r.matched).toBe(1);

    // Payout flow: the withdrawal is the net, the fee a row of its own, and the
    // reversal gives back both.
    const net = withdrawal({ amount: 19_300, feeMinor: 0, debitedMinor: 20_000, reversedMinor: 20_000 });
    const flow = run({ payouts: [payout({ status: 'failed' })], withdrawals: [net] });
    expect(flow.mismatches).toEqual([]);
    expect(flow.matched).toBe(1);
  });

  it('treats a payout taken back after it was paid like a refusal', () => {
    const net = withdrawal({ amount: 19_300, feeMinor: 0, debitedMinor: 20_000 });
    const back = run({ payouts: [payout({ status: 'reversed' })], withdrawals: [{ ...net, reversedMinor: 20_000 }] });
    expect(back.mismatches).toEqual([]);
    expect(back.matched).toBe(1);

    const kept = run({ payouts: [payout({ status: 'reversed' })], withdrawals: [net] });
    expect(kinds(kept)).toEqual(['payout_failed_but_debited']);
    expect(kept.mismatches[0]).toMatchObject({ recordedMinor: 20_000 });
  });

  it('still reports a refused payout whose debit was not credited back, or only in part', () => {
    const none = run({ payouts: [payout({ status: 'failed' })], withdrawals: [withdrawal()] });
    expect(kinds(none)).toEqual(['payout_failed_but_debited']);
    expect(none.mismatches[0]).toMatchObject({ expectedMinor: 0, recordedMinor: 20_000 });

    // The withdrawal came back and the fee did not.
    const part = run({ payouts: [payout({ status: 'failed' })], withdrawals: [withdrawal({ reversedMinor: 19_300 })] });
    expect(kinds(part)).toEqual(['payout_failed_but_debited']);
    expect(part.mismatches[0]).toMatchObject({ expectedMinor: 0, recordedMinor: 700 });
  });

  it('lists a debited payout the provider has not confirmed as unresolved', () => {
    const r = run({ payouts: [payout({ status: 'pending' })], withdrawals: [withdrawal()] });
    expect(r.mismatches).toEqual([]);
    expect(r.pending.map((p) => p.purpose)).toEqual(['payout']);
  });
});
