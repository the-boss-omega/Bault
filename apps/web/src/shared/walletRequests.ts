import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

export type WalletRequestType = 'cash_in' | 'cash_out';

export type WalletRequestStatus =
  | 'submitted'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'paying'
  | 'payout_failed';

export const WALLET_REQUEST_STATUSES: readonly WalletRequestStatus[] = [
  'submitted',
  'pending_review',
  'approved',
  'processing',
  'paying',
  'completed',
  'payout_failed',
  'rejected',
  'cancelled',
];

export const OPEN_WALLET_REQUEST_STATUSES: readonly WalletRequestStatus[] = [
  'submitted',
  'pending_review',
  'approved',
  'processing',
];

export function isOpenRequest(status: string): boolean {
  return (OPEN_WALLET_REQUEST_STATUSES as readonly string[]).includes(status);
}

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
  payoutReference?: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  username?: string | null;
  customerName?: string | null;
  email?: string | null;
}

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

export interface WalletRequestPayout {
  id: string;
  provider: string;
  status: string;
  amount: number;
  externalRef: string | null;
}

export interface WalletRequestDetail extends WalletRequest {
  history: WalletRequestEvent[];
  payout?: WalletRequestPayout | null;
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

export const WALLET_REQUEST_TONE: Record<string, StatusTone> = {
  submitted: 'info',
  pending_review: 'warning',
  approved: 'gold',
  processing: 'info',
  paying: 'info',
  completed: 'success',
  rejected: 'error',
  payout_failed: 'error',
  cancelled: 'neutral',
};

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
  availableMinor?: number;
}

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
