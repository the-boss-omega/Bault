/**
 * The rules a wallet cash-in / cash-out request is held to.
 *
 * They live in one module, apart from the service, for two reasons: the SPA
 * mirrors them in `apps/web/src/shared/walletRequests.ts` so a user is told a
 * limit before submitting rather than after, and the transition table below is
 * the single place the lifecycle is defined — the service asks this module
 * whether a move is legal instead of scattering `if (status === …)` chains.
 *
 * Nothing here talks to the database, so all of it is directly testable.
 */

export type WalletRequestType = 'cash_in' | 'cash_out';

export type WalletRequestStatus =
  | 'submitted'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'processing'
  | 'completed'
  | 'cancelled';

/**
 * The lifecycle, as an explicit adjacency list.
 *
 * `draft` is deliberately not a status: nothing in the product persists an
 * unsubmitted request, and a status with no path into it would be a lie in the
 * enum and in the UI. Everything below is reachable.
 *
 *   submitted ──▶ pending_review ──▶ approved ──▶ processing ──▶ completed
 *        │               │              │
 *        └──▶ cancelled  ├──▶ rejected  └──▶ rejected
 *                        └──▶ cancelled
 *
 * `completed` is the ONLY status that moves money, and it is terminal, so a
 * balance can never be changed twice by the same request.
 */
export const WALLET_REQUEST_TRANSITIONS: Readonly<Record<WalletRequestStatus, readonly WalletRequestStatus[]>> = {
  submitted: ['pending_review', 'approved', 'rejected', 'cancelled'],
  pending_review: ['approved', 'rejected', 'cancelled'],
  approved: ['processing', 'completed', 'rejected'],
  processing: ['completed', 'rejected'],
  rejected: [],
  completed: [],
  cancelled: [],
};

/** Statuses a request can still move out of — i.e. it is still someone's work. */
export const OPEN_WALLET_REQUEST_STATUSES: readonly WalletRequestStatus[] = [
  'submitted',
  'pending_review',
  'approved',
  'processing',
];

export function isOpenStatus(status: WalletRequestStatus): boolean {
  return OPEN_WALLET_REQUEST_STATUSES.includes(status);
}

export function canTransition(from: WalletRequestStatus, to: WalletRequestStatus): boolean {
  return (WALLET_REQUEST_TRANSITIONS[from] ?? []).includes(to);
}

/** Transitions only the requester may perform. Everything else is a reviewer's. */
export const REQUESTER_TRANSITIONS: readonly WalletRequestStatus[] = ['cancelled'];

/**
 * Amount limits, in minor units (USD cents).
 *
 * A minimum exists because the review of a request costs a person's attention
 * and a $0.05 cash-out cannot repay it. The maximum is the ceiling above which
 * this product does not claim to operate; it is enforced rather than merely
 * documented so an accidental extra zero is refused at submission.
 */
export const WALLET_REQUEST_LIMITS: Readonly<
  Record<WalletRequestType, { minMinor: number; maxMinor: number }>
> = {
  cash_in: { minMinor: 1_000, maxMinor: 2_000_000 }, // $10 … $20,000
  cash_out: { minMinor: 2_000, maxMinor: 2_000_000 }, // $20 … $20,000
};

/** The only settlement currency this platform operates in (Requirement 7.1). */
export const SUPPORTED_CURRENCIES: readonly string[] = ['USD'];

/** Funding sources a cash-in may name. Free text would be unreviewable. */
export const FUNDING_SOURCES: readonly string[] = [
  'bank_transfer',
  'card',
  'paypal',
  'crypto',
  'other',
];

export const MAX_NOTE_LENGTH = 500;
export const MAX_REFERENCE_LENGTH = 120;
export const MAX_REJECTION_REASON_LENGTH = 500;

export interface WalletRequestDraft {
  type: WalletRequestType;
  amountMinor: number;
  currency: string;
  fundingSource?: string | null;
  destinationAccount?: string | null;
  beneficiaryName?: string | null;
  reference?: string | null;
  documentKey?: string | null;
  notes?: string | null;
}

/** One rejected rule, named by the field it applies to. */
export interface WalletRequestViolation {
  field: string;
  code: string;
  message: string;
}

/**
 * Validate a draft against every rule that does not need the database.
 *
 * Balance is NOT checked here — it is a database question and, more importantly,
 * it has to be re-checked at completion time rather than trusted from submission
 * time. See `WalletRequestService.complete`.
 */
export function validateWalletRequestDraft(draft: WalletRequestDraft): WalletRequestViolation[] {
  const problems: WalletRequestViolation[] = [];
  const limits = WALLET_REQUEST_LIMITS[draft.type];

  if (!Number.isInteger(draft.amountMinor) || draft.amountMinor <= 0) {
    problems.push({
      field: 'amountMinor',
      code: 'amount_not_positive',
      message: 'Amount must be a positive whole number of cents.',
    });
  } else if (draft.amountMinor < limits.minMinor) {
    problems.push({
      field: 'amountMinor',
      code: 'amount_below_minimum',
      message: `Amount is below the ${limits.minMinor / 100} minimum for this request type.`,
    });
  } else if (draft.amountMinor > limits.maxMinor) {
    problems.push({
      field: 'amountMinor',
      code: 'amount_above_maximum',
      message: `Amount is above the ${limits.maxMinor / 100} maximum for this request type.`,
    });
  }

  if (!SUPPORTED_CURRENCIES.includes(draft.currency?.toUpperCase() ?? '')) {
    problems.push({
      field: 'currency',
      code: 'currency_unsupported',
      message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}.`,
    });
  }

  if (draft.type === 'cash_in') {
    if (!draft.fundingSource || !FUNDING_SOURCES.includes(draft.fundingSource)) {
      problems.push({
        field: 'fundingSource',
        code: 'funding_source_required',
        message: `Funding source must be one of: ${FUNDING_SOURCES.join(', ')}.`,
      });
    }
  } else {
    if (!draft.destinationAccount || draft.destinationAccount.trim().length < 4) {
      problems.push({
        field: 'destinationAccount',
        code: 'destination_required',
        message: 'A destination account is required for a cash-out.',
      });
    }
    if (!draft.beneficiaryName || draft.beneficiaryName.trim().length < 2) {
      problems.push({
        field: 'beneficiaryName',
        code: 'beneficiary_required',
        message: 'Beneficiary details are required for a cash-out.',
      });
    }
  }

  if ((draft.notes?.length ?? 0) > MAX_NOTE_LENGTH) {
    problems.push({ field: 'notes', code: 'notes_too_long', message: `Notes are limited to ${MAX_NOTE_LENGTH} characters.` });
  }
  if ((draft.reference?.length ?? 0) > MAX_REFERENCE_LENGTH) {
    problems.push({
      field: 'reference',
      code: 'reference_too_long',
      message: `Reference is limited to ${MAX_REFERENCE_LENGTH} characters.`,
    });
  }

  return problems;
}

/**
 * Whether two requests are "the same request submitted twice".
 *
 * Identity is type + amount + currency + REFERENCE. The reference matters
 * because it is the only field that distinguishes two genuinely different
 * transfers of the same amount: a customer paying in $250 against wire 8842-A
 * and another $250 against wire 8843-B has two real requests, not one duplicate.
 *
 * What this still catches is the case it exists for — the double-click and the
 * retried submission, which repeat the same reference, or carry none at all. Two
 * requests with no reference and the same amount are treated as one intention.
 *
 * The guard applies only while the first request is still OPEN. Once it has been
 * decided, an identical request is a new intention and is allowed.
 */
export function isDuplicateOf(
  a: WalletRequestDraft,
  b: { type: string; amount: number; currency: string; reference: string | null },
): boolean {
  return (
    a.type === b.type &&
    a.amountMinor === b.amount &&
    a.currency.toUpperCase() === b.currency.toUpperCase() &&
    (a.reference ?? null) === (b.reference ?? null)
  );
}
