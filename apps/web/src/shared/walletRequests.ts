import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

/**
 * The SPA's copy of the wallet-request rules and vocabulary.
 *
 * Mirrors `apps/api/src/modules/pay/wallet-request.rules.ts` by value — same
 * statuses, same limits, same funding sources — so a form can refuse an amount
 * before the round trip and can never permit one the API will reject. Matched by
 * `tests/web/wallet-requests.test.ts`.
 *
 * Nothing here decides anything: the API is the authority on whether a request
 * is valid and on when money moves. This module exists so the UI can be honest
 * about the rules while it types, not so it can enforce them.
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

/** In display order — this is also the order the review queue groups by. */
export const WALLET_REQUEST_STATUSES: readonly WalletRequestStatus[] = [
  'submitted',
  'pending_review',
  'approved',
  'processing',
  'completed',
  'rejected',
  'cancelled',
];

/** Statuses that still represent somebody's open work. */
export const OPEN_WALLET_REQUEST_STATUSES: readonly WalletRequestStatus[] = [
  'submitted',
  'pending_review',
  'approved',
  'processing',
];

export function isOpenRequest(status: string): boolean {
  return (OPEN_WALLET_REQUEST_STATUSES as readonly string[]).includes(status);
}

/** A requester may withdraw their own request only while nobody has decided it. */
export function canCancel(status: string): boolean {
  return status === 'submitted' || status === 'pending_review';
}

export const WALLET_REQUEST_LIMITS: Record<WalletRequestType, { minMinor: number; maxMinor: number }> = {
  cash_in: { minMinor: 1_000, maxMinor: 2_000_000 },
  cash_out: { minMinor: 2_000, maxMinor: 2_000_000 },
};

export const FUNDING_SOURCES = ['bank_transfer', 'card', 'paypal', 'crypto', 'other'] as const;
export type FundingSource = (typeof FUNDING_SOURCES)[number];

export const MAX_NOTE_LENGTH = 500;
export const MAX_REFERENCE_LENGTH = 120;

/** One wallet request, as both the customer list and the review queue see it. */
export interface WalletRequest {
  id: string;
  code: string;
  userId: string;
  type: WalletRequestType;
  status: WalletRequestStatus;
  amount: number;
  currency: string;
  fundingSource: string | null;
  destinationAccount: string | null;
  beneficiaryName: string | null;
  reference: string | null;
  documentKey: string | null;
  notes: string | null;
  settledLedgerId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on the review queue only (joined from the account). */
  username?: string | null;
  customerName?: string | null;
  email?: string | null;
}

/** One immutable row of the request's audit history. */
export interface WalletRequestEvent {
  id: string;
  requestId: string;
  actorId: string | null;
  actorRole: string | null;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  occurredAt: string;
}

export interface WalletRequestDetail extends WalletRequest {
  history: WalletRequestEvent[];
  /** A readable, expiring URL for the supporting document, when there is one. */
  documentUrl?: string | null;
}

export function statusLabel(t: TranslateFn, status: string): string {
  return t(`wallet.request.status.${status}` as MessageKey);
}

export function typeLabel(t: TranslateFn, type: string): string {
  return t(`wallet.request.type.${type}` as MessageKey);
}

export function fundingSourceLabel(t: TranslateFn, source: string | null): string {
  if (!source) return '—';
  return t(`wallet.request.funding.${source}` as MessageKey);
}

/**
 * Status → badge tone. `completed` is the only green: it is the only status at
 * which money has actually moved, and the colour should not suggest otherwise
 * for `approved`, where nothing has yet.
 */
export const WALLET_REQUEST_TONE: Record<string, StatusTone> = {
  submitted: 'info',
  pending_review: 'warning',
  approved: 'gold',
  processing: 'info',
  completed: 'success',
  rejected: 'error',
  cancelled: 'neutral',
};

/** One rejected rule, keyed by field so a form can put it under the right input. */
export interface DraftProblem {
  field: string;
  messageKey: MessageKey;
  vars?: Record<string, string | number>;
}

export interface WalletRequestDraftInput {
  type: WalletRequestType;
  amountMinor: number | null;
  fundingSource?: string;
  destinationAccount?: string;
  beneficiaryName?: string;
  notes?: string;
  reference?: string;
  /** Available balance in minor units; only consulted for a cash-out. */
  availableMinor?: number;
}

/**
 * Validate what the form can validate. Deliberately mirrors the API's checks so
 * the user is told the rule while typing, and returns MESSAGE KEYS rather than
 * sentences so every message is translated like the rest of the interface.
 */
export function validateDraft(draft: WalletRequestDraftInput): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const limits = WALLET_REQUEST_LIMITS[draft.type];

  if (draft.amountMinor === null || draft.amountMinor <= 0) {
    problems.push({ field: 'amount', messageKey: 'wallet.request.error.amountInvalid' });
  } else if (draft.amountMinor < limits.minMinor) {
    problems.push({
      field: 'amount',
      messageKey: 'wallet.request.error.amountBelowMin',
      vars: { min: (limits.minMinor / 100).toFixed(2) },
    });
  } else if (draft.amountMinor > limits.maxMinor) {
    problems.push({
      field: 'amount',
      messageKey: 'wallet.request.error.amountAboveMax',
      vars: { max: (limits.maxMinor / 100).toFixed(2) },
    });
  } else if (
    draft.type === 'cash_out' &&
    draft.availableMinor !== undefined &&
    draft.amountMinor > draft.availableMinor
  ) {
    problems.push({
      field: 'amount',
      messageKey: 'wallet.request.error.overBalance',
      vars: { available: (draft.availableMinor / 100).toFixed(2) },
    });
  }

  if (draft.type === 'cash_in') {
    if (!draft.fundingSource || !(FUNDING_SOURCES as readonly string[]).includes(draft.fundingSource)) {
      problems.push({ field: 'fundingSource', messageKey: 'wallet.request.error.fundingRequired' });
    }
  } else {
    if (!draft.destinationAccount || draft.destinationAccount.trim().length < 4) {
      problems.push({ field: 'destinationAccount', messageKey: 'wallet.request.error.destinationRequired' });
    }
    if (!draft.beneficiaryName || draft.beneficiaryName.trim().length < 2) {
      problems.push({ field: 'beneficiaryName', messageKey: 'wallet.request.error.beneficiaryRequired' });
    }
  }

  if ((draft.notes?.length ?? 0) > MAX_NOTE_LENGTH) {
    problems.push({ field: 'notes', messageKey: 'wallet.request.error.notesTooLong' });
  }
  if ((draft.reference?.length ?? 0) > MAX_REFERENCE_LENGTH) {
    problems.push({ field: 'reference', messageKey: 'wallet.request.error.referenceTooLong' });
  }

  return problems;
}

/**
 * Whether an identical request is already open.
 *
 * Identity is type + amount + currency + REFERENCE, matching the API's
 * `isDuplicateOf`. The reference is part of it because it is the only field that
 * distinguishes two genuinely different transfers of the same amount; a
 * double-click repeats it (or carries none), which is what this catches.
 *
 * The API refuses the duplicate outright — this only lets the form say so BEFORE
 * the submission rather than turning a double-click into an error banner.
 */
export function findOpenDuplicate(
  existing: readonly WalletRequest[],
  draft: {
    type: WalletRequestType;
    amountMinor: number | null;
    currency?: string;
    reference?: string | null;
  },
): WalletRequest | null {
  if (draft.amountMinor === null) return null;
  const currency = (draft.currency ?? 'USD').toUpperCase();
  const reference = draft.reference?.trim() ? draft.reference.trim() : null;
  return (
    existing.find(
      (r) =>
        isOpenRequest(r.status) &&
        r.type === draft.type &&
        r.amount === draft.amountMinor &&
        r.currency.toUpperCase() === currency &&
        (r.reference ?? null) === reference,
    ) ?? null
  );
}

/**
 * Free-text search over the customer's own request list: code, type, status,
 * reference and amount, so the box matches what is on screen.
 */
export function matchesRequestSearch(request: WalletRequest, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return [
    request.code,
    request.type,
    request.status,
    request.reference ?? '',
    request.beneficiaryName ?? '',
    request.destinationAccount ?? '',
    request.username ?? '',
    request.customerName ?? '',
    (request.amount / 100).toFixed(2),
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}
