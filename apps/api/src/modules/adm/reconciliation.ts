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
  payoutRef: string | null;
  feeMinor: number;
  debitedMinor: number;
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
        matched += 1;
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
    const stillDebited = w.debitedMinor - w.reversedMinor;
    if ((p.status === 'failed' || p.status === 'reversed') && stillDebited !== 0) {
      const what = p.status === 'failed' ? 'failed' : 'was taken back after it was paid';
      found.push({
        ...base,
        kind: 'payout_failed_but_debited',
        detail:
          w.reversedMinor === 0
            ? `The provider reports this payout ${what}, and the wallet was debited anyway.`
            : `The provider reports this payout ${what}, and the wallet was credited back a different amount than it was debited.`,
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
