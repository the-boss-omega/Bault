import { formatMinor } from '../../shared/money';

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

export const WALLET_REQUEST_TRANSITIONS: Readonly<Record<WalletRequestStatus, readonly WalletRequestStatus[]>> = {
  submitted: ['pending_review', 'approved', 'rejected', 'cancelled'],
  pending_review: ['approved', 'rejected', 'cancelled'],
  approved: ['processing', 'completed', 'paying', 'rejected'],
  processing: ['completed', 'paying', 'rejected'],
  paying: ['completed', 'payout_failed'],
  rejected: [],
  completed: ['payout_failed'],
  cancelled: [],
  payout_failed: [],
};

export const OPEN_WALLET_REQUEST_STATUSES: readonly WalletRequestStatus[] = [
  'submitted',
  'pending_review',
  'approved',
  'processing',
];

export function canTransition(from: WalletRequestStatus, to: WalletRequestStatus): boolean {
  return (WALLET_REQUEST_TRANSITIONS[from] ?? []).includes(to);
}

export const WALLET_REQUEST_LIMITS: Readonly<
  Record<WalletRequestType, { minMinor: number; maxMinor: number }>
> = {
  cash_in: { minMinor: 1_000, maxMinor: 2_000_000 },
  cash_out: { minMinor: 2_000, maxMinor: 2_000_000 },
};

export const SUPPORTED_CURRENCIES: readonly string[] = ['USD'];

export const FUNDING_SOURCES: readonly string[] = [
  'bank_transfer',
  'card',
  'paypal',
  'crypto',
  'other',
];

const FUNDING_SOURCE_LABELS = 'a bank transfer, a card, PayPal, crypto or another way';

export const MAX_DESTINATION_LENGTH = 140;
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

export interface WalletRequestViolation {
  field: string;
  code: string;
  message: string;
}

export function validateWalletRequestDraft(draft: WalletRequestDraft): WalletRequestViolation[] {
  const problems: WalletRequestViolation[] = [];
  const limits = WALLET_REQUEST_LIMITS[draft.type];

  const what = draft.type === 'cash_out' ? 'cash-out' : 'cash-in';
  if (!Number.isInteger(draft.amountMinor) || draft.amountMinor <= 0) {
    problems.push({
      field: 'amountMinor',
      code: 'amount_not_positive',
      message: 'Enter an amount above $0.00, to the cent.',
    });
  } else if (draft.amountMinor < limits.minMinor) {
    problems.push({
      field: 'amountMinor',
      code: 'amount_below_minimum',
      message: `The smallest ${what} is ${formatMinor(limits.minMinor)}.`,
    });
  } else if (draft.amountMinor > limits.maxMinor) {
    problems.push({
      field: 'amountMinor',
      code: 'amount_above_maximum',
      message: `The largest ${what} is ${formatMinor(limits.maxMinor)}.`,
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
        message: `Say how the money was sent: ${FUNDING_SOURCE_LABELS}.`,
      });
    }
  } else {
    if (!draft.destinationAccount || draft.destinationAccount.trim().length < 4) {
      problems.push({
        field: 'destinationAccount',
        code: 'destination_required',
        message: 'A destination account is required for a cash-out.',
      });
    } else if (draft.destinationAccount.length > MAX_DESTINATION_LENGTH) {
      problems.push({
        field: 'destinationAccount',
        code: 'destination_too_long',
        message: `The destination account is limited to ${MAX_DESTINATION_LENGTH} characters.`,
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

  if (draft.type === 'cash_out' && draft.documentKey) {
    problems.push({
      field: 'documentKey',
      code: 'receipt_cash_in_only',
      message: 'A receipt goes on a cash-in request, not on a cash-out.',
    });
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
