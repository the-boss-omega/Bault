/**
 * External payments against the ledger rows that cite them.
 *
 * The ledger is the only record of what a wallet holds, and `external_payment`
 * is the only record of money that actually moved at a provider. A payment
 * marked `succeeded` with no credit behind it is a customer who paid and was
 * never credited; a credit with no settled payment behind it is store credit
 * minted from nothing.
 *
 * What each side must look like when the two agree:
 *
 *   top-up, succeeded   exactly one `credit_topup` credit for the amount paid
 *   top-up, reversed    that credit, plus one `chargeback` debit for the same
 *   top-up, otherwise   no credit and no chargeback (a `pending` one is listed
 *                       separately: its outcome is unknown, and that is what
 *                       somebody has to go and ask the provider about)
 *   payout              the `withdrawal` debit whose completion recorded this
 *                       payout's reference, for the payout plus its fee
 *   payout, failed      that debit, credited back in full (withdrawal and
 *                       fee) by `payout_reversal` rows on the same request
 *   withdrawal debit    a payout behind it: money left a wallet, so money
 *                       must have left Bault
 *
 * Pure: the service gathers the facts in SQL and this decides what they mean,
 * so every rule here is testable without a database
 * (`tests3/contract/reconciliation.test.ts`).
 *
 * Cash-ins by bank transfer or PayPal Friends & Family are NOT here. They are
 * credited through reviewed wallet requests, no provider reports them, and the
 * thing to reconcile them against is the bank statement. The report counts
 * them so nobody mistakes their absence for their being checked.
 */

export interface TopupFacts {
  id: string;
  userId: string;
  username: string | null;
  provider: string;
  status: string;
  amount: number;
  createdAt: Date | string;
  creditCount: number;
  creditSum: number;
  chargebackCount: number;
  chargebackSum: number;
  /** Ledger rows citing this payment that are neither of the two above. */
  otherCount: number;
}

export interface PayoutFacts {
  id: string;
  userId: string;
  username: string | null;
  status: string;
  amount: number;
  providerRef: string;
  createdAt: Date | string;
}

export interface WithdrawalFacts {
  ledgerId: string;
  userId: string;
  username: string | null;
  amount: number;
  occurredAt: Date | string;
  walletRequestId: string | null;
  /** The provider reference the completion recorded, when it recorded one. */
  payoutRef: string | null;
  /** The fee taken alongside it, which the payout does not carry. */
  feeMinor: number;
  /**
   * Everything the cash-out took from the wallet: the withdrawal and its fee,
   * whether the fee is inside the row (older shape) or a row of its own.
   */
  debitedMinor: number;
  /** What `payout_reversal` credits on the same request have given back. */
  reversedMinor: number;
}

export interface OrphanLedgerFacts {
  ledgerId: string;
  userId: string;
  username: string | null;
  type: string;
  direction: string;
  amount: number;
  referenceId: string | null;
  occurredAt: Date | string;
}

export type MismatchKind =
  | 'succeeded_without_credit'
  | 'duplicate_credit'
  | 'credit_amount_mismatch'
  | 'credit_without_settled_payment'
  | 'reversed_without_chargeback'
  | 'chargeback_amount_mismatch'
  | 'chargeback_without_reversal'
  | 'unexpected_ledger_row'
  | 'ledger_references_missing_payment'
  | 'payout_without_withdrawal'
  | 'payout_amount_mismatch'
  | 'payout_failed_but_debited'
  | 'withdrawal_without_payout';

export interface Mismatch {
  kind: MismatchKind;
  detail: string;
  paymentId: string | null;
  ledgerId: string | null;
  walletRequestId: string | null;
  userId: string;
  username: string | null;
  status: string | null;
  expectedMinor: number | null;
  recordedMinor: number | null;
  at: string;
}

export interface Unresolved {
  paymentId: string;
  purpose: 'topup' | 'payout';
  userId: string;
  username: string | null;
  amount: number;
  at: string;
  detail: string;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const SETTLED = new Set(['succeeded', 'reversed']);

export function reconcile(input: {
  topups: TopupFacts[];
  payouts: PayoutFacts[];
  withdrawals: WithdrawalFacts[];
  orphans: OrphanLedgerFacts[];
}) {
  const mismatches: Mismatch[] = [];
  const pending: Unresolved[] = [];
  let matched = 0;

  /* ---- money in ---- */
  for (const p of input.topups) {
    const found: Mismatch[] = [];
    const flag = (kind: MismatchKind, detail: string, expectedMinor: number | null, recordedMinor: number | null) =>
      found.push({
        kind,
        detail,
        paymentId: p.id,
        ledgerId: null,
        walletRequestId: null,
        userId: p.userId,
        username: p.username,
        status: p.status,
        expectedMinor,
        recordedMinor,
        at: iso(p.createdAt),
      });

    if (SETTLED.has(p.status)) {
      if (p.creditCount === 0) {
        flag('succeeded_without_credit', 'The provider took this payment and no wallet was credited for it.', p.amount, 0);
      } else if (p.creditCount > 1) {
        flag('duplicate_credit', `This payment was credited ${p.creditCount} times.`, p.amount, p.creditSum);
      } else if (p.creditSum !== p.amount) {
        flag('credit_amount_mismatch', 'The credit is not the amount the provider took.', p.amount, p.creditSum);
      }
      if (p.status === 'reversed') {
        if (p.chargebackCount === 0) {
          flag('reversed_without_chargeback', 'The payment was reversed and the credit was never taken back.', p.amount, 0);
        } else if (p.chargebackSum !== p.amount) {
          flag('chargeback_amount_mismatch', 'The chargeback is not the amount that was reversed.', p.amount, p.chargebackSum);
        }
      } else if (p.chargebackCount > 0) {
        flag('chargeback_without_reversal', 'A chargeback is on the ledger for a payment still marked succeeded.', 0, p.chargebackSum);
      }
    } else {
      if (p.creditCount > 0) {
        flag('credit_without_settled_payment', `A wallet was credited for a payment that is ${p.status}.`, 0, p.creditSum);
      }
      if (p.chargebackCount > 0) {
        flag('chargeback_without_reversal', `A chargeback is on the ledger for a payment that is ${p.status}.`, 0, p.chargebackSum);
      }
      if (p.status === 'pending' && found.length === 0) {
        pending.push({
          paymentId: p.id,
          purpose: 'topup',
          userId: p.userId,
          username: p.username,
          amount: p.amount,
          at: iso(p.createdAt),
          detail: 'Outcome unknown: the provider was asked and never answered. Look it up at the provider before crediting anything.',
        });
      }
    }
    if (p.otherCount > 0) {
      flag('unexpected_ledger_row', `${p.otherCount} ledger row(s) cite this payment that are neither its credit nor its chargeback.`, null, null);
    }

    mismatches.push(...found);
    if (found.length === 0 && p.status !== 'pending') matched += 1;
  }

  for (const o of input.orphans) {
    mismatches.push({
      kind: 'ledger_references_missing_payment',
      detail: `A ${o.type} ${o.direction} cites an external payment that does not exist.`,
      paymentId: o.referenceId,
      ledgerId: o.ledgerId,
      walletRequestId: null,
      userId: o.userId,
      username: o.username,
      status: null,
      expectedMinor: 0,
      recordedMinor: o.amount,
      at: iso(o.occurredAt),
    });
  }

  /* ---- money out ---- */
  // A payout is tied to its debit by the reference the completion recorded.
  // Keyed by user AND reference, so one account's debit can never vouch for
  // another account's payout.
  const withdrawalByRef = new Map<string, WithdrawalFacts>();
  for (const w of input.withdrawals) {
    if (w.payoutRef) withdrawalByRef.set(`${w.userId}|${w.payoutRef}`, w);
  }
  const vouched = new Set<string>();

  for (const p of input.payouts) {
    const w = withdrawalByRef.get(`${p.userId}|${p.providerRef}`);
    const base = {
      paymentId: p.id,
      userId: p.userId,
      username: p.username,
      status: p.status,
      at: iso(p.createdAt),
    };
    if (!w) {
      if (p.status === 'failed') {
        matched += 1; // nothing was paid and nothing was debited
        continue;
      }
      mismatches.push({
        ...base,
        kind: 'payout_without_withdrawal',
        detail: 'Money was sent out at the provider and no wallet was debited for it.',
        ledgerId: null,
        walletRequestId: null,
        expectedMinor: p.amount,
        recordedMinor: 0,
      });
      continue;
    }
    vouched.add(w.ledgerId);
    const found: Mismatch[] = [];
    const expectedNet = w.amount - w.feeMinor;
    if (p.amount !== expectedNet) {
      found.push({
        ...base,
        kind: 'payout_amount_mismatch',
        detail: 'The payout is not the amount debited less the fee.',
        ledgerId: w.ledgerId,
        walletRequestId: w.walletRequestId,
        expectedMinor: expectedNet,
        recordedMinor: p.amount,
      });
    }
    // A refused payout is settled once the cash-out has been credited back in
    // full, which `recordPayoutOutcome` does in the same transaction that
    // records the refusal. Only what is still debited is a mismatch.
    const stillDebited = w.debitedMinor - w.reversedMinor;
    if (p.status === 'failed' && stillDebited !== 0) {
      found.push({
        ...base,
        kind: 'payout_failed_but_debited',
        detail:
          w.reversedMinor === 0
            ? 'The provider reports this payout failed, and the wallet was debited anyway.'
            : 'The provider reports this payout failed, and the wallet was credited back a different amount than it was debited.',
        ledgerId: w.ledgerId,
        walletRequestId: w.walletRequestId,
        expectedMinor: 0,
        recordedMinor: stillDebited,
      });
    }
    mismatches.push(...found);
    if (found.length === 0) {
      if (p.status === 'pending') {
        pending.push({
          paymentId: p.id,
          purpose: 'payout',
          userId: p.userId,
          username: p.username,
          amount: p.amount,
          at: iso(p.createdAt),
          detail: 'Debited, and the provider has not yet confirmed the payout went through.',
        });
      } else {
        matched += 1;
      }
    }
  }

  for (const w of input.withdrawals) {
    if (vouched.has(w.ledgerId)) continue;
    mismatches.push({
      kind: 'withdrawal_without_payout',
      detail: 'Money left this wallet and no payout at any provider records it leaving Bault.',
      paymentId: null,
      ledgerId: w.ledgerId,
      walletRequestId: w.walletRequestId,
      userId: w.userId,
      username: w.username,
      status: null,
      expectedMinor: w.amount - w.feeMinor,
      recordedMinor: w.amount,
      at: iso(w.occurredAt),
    });
  }

  mismatches.sort((a, b) => b.at.localeCompare(a.at));
  return {
    checked: {
      topups: input.topups.length,
      payouts: input.payouts.length,
      withdrawals: input.withdrawals.length,
    },
    matched,
    mismatches,
    pending,
  };
}
