import { describe, it, expect } from 'vitest';
import {
  FUNDING_SOURCES,
  OPEN_WALLET_REQUEST_STATUSES,
  WALLET_REQUEST_LIMITS,
  WALLET_REQUEST_STATUSES,
  WALLET_REQUEST_TONE,
  canCancel,
  findOpenDuplicate,
  isOpenRequest,
  matchesRequestSearch,
  validateDraft,
  type WalletRequest,
} from '../../apps/web/src/shared/walletRequests';
import { reviewerActions } from '../../apps/web/src/areas/admin/WalletRequestsSection';

/**
 * Wallet cash-in / cash-out request rules, as the SPA applies them.
 *
 * The API enforces every one of these again — nothing here is a security
 * boundary. What these tests protect is that the form tells the user the SAME
 * rule the server will apply, so a submission is never refused for a reason the
 * interface had already accepted.
 */

/** A minimal request row, overridable per case. */
function request(overrides: Partial<WalletRequest> = {}): WalletRequest {
  return {
    id: 'r1',
    code: 'WR-ABCD1234',
    userId: 'u1',
    type: 'cash_in',
    status: 'submitted',
    amount: 25_000,
    currency: 'USD',
    fundingSource: 'bank_transfer',
    destinationAccount: null,
    beneficiaryName: null,
    reference: null,
    documentKey: null,
    notes: null,
    settledLedgerId: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    completedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('wallet request lifecycle', () => {
  it('has no draft status — nothing in the product saves an unsubmitted request', () => {
    expect(WALLET_REQUEST_STATUSES).not.toContain('draft');
  });

  it('treats exactly the undecided statuses as open', () => {
    expect([...OPEN_WALLET_REQUEST_STATUSES]).toEqual([
      'submitted',
      'pending_review',
      'approved',
      'processing',
    ]);
    for (const terminal of ['completed', 'rejected', 'cancelled']) {
      expect(isOpenRequest(terminal)).toBe(false);
    }
  });

  it('lets the requester cancel only before a decision is made', () => {
    expect(canCancel('submitted')).toBe(true);
    expect(canCancel('pending_review')).toBe(true);
    // Once approved, the request is the reviewer's to finish or reject.
    expect(canCancel('approved')).toBe(false);
    expect(canCancel('processing')).toBe(false);
    expect(canCancel('completed')).toBe(false);
  });

  it('colours only `completed` as success — approval has moved no money', () => {
    expect(WALLET_REQUEST_TONE.completed).toBe('success');
    expect(WALLET_REQUEST_TONE.approved).not.toBe('success');
    expect(WALLET_REQUEST_TONE.processing).not.toBe('success');
  });
});

describe('reviewer actions offered per status', () => {
  it('offers completion only from approved or processing', () => {
    expect(reviewerActions('approved')).toContain('complete');
    expect(reviewerActions('processing')).toContain('complete');
    expect(reviewerActions('submitted')).not.toContain('complete');
    expect(reviewerActions('pending_review')).not.toContain('complete');
  });

  it('offers nothing at all on a terminal request', () => {
    for (const terminal of ['completed', 'rejected', 'cancelled']) {
      expect(reviewerActions(terminal)).toHaveLength(0);
    }
  });

  it('never offers cancellation — that belongs to the requester', () => {
    for (const status of WALLET_REQUEST_STATUSES) {
      expect(reviewerActions(status)).not.toContain('cancel');
    }
  });
});

describe('wallet request validation', () => {
  const cashIn = { type: 'cash_in' as const, amountMinor: 25_000, fundingSource: 'bank_transfer' };
  const cashOut = {
    type: 'cash_out' as const,
    amountMinor: 25_000,
    destinationAccount: 'IL62 0108 0000 0009 9999 999',
    beneficiaryName: 'Golden Marsh',
  };

  it('accepts a well-formed request of either kind', () => {
    expect(validateDraft(cashIn)).toHaveLength(0);
    expect(validateDraft(cashOut)).toHaveLength(0);
  });

  it('requires a positive amount', () => {
    expect(validateDraft({ ...cashIn, amountMinor: null }).some((p) => p.field === 'amount')).toBe(true);
    expect(validateDraft({ ...cashIn, amountMinor: 0 }).some((p) => p.field === 'amount')).toBe(true);
    expect(validateDraft({ ...cashIn, amountMinor: -500 }).some((p) => p.field === 'amount')).toBe(true);
  });

  it('enforces the published minimum and maximum', () => {
    const { minMinor, maxMinor } = WALLET_REQUEST_LIMITS.cash_in;
    expect(validateDraft({ ...cashIn, amountMinor: minMinor - 1 })[0]?.messageKey).toBe(
      'wallet.request.error.amountBelowMin',
    );
    expect(validateDraft({ ...cashIn, amountMinor: maxMinor + 1 })[0]?.messageKey).toBe(
      'wallet.request.error.amountAboveMax',
    );
    // The bounds themselves are inclusive.
    expect(validateDraft({ ...cashIn, amountMinor: minMinor })).toHaveLength(0);
    expect(validateDraft({ ...cashIn, amountMinor: maxMinor })).toHaveLength(0);
  });

  it('refuses a cash-out larger than the available balance', () => {
    const problems = validateDraft({ ...cashOut, amountMinor: 30_000, availableMinor: 25_000 });
    expect(problems[0]?.messageKey).toBe('wallet.request.error.overBalance');
    // Equal to the balance is fine — a user may cash out everything.
    expect(validateDraft({ ...cashOut, amountMinor: 25_000, availableMinor: 25_000 })).toHaveLength(0);
  });

  it('does not apply the balance rule to a cash-in', () => {
    expect(validateDraft({ ...cashIn, amountMinor: 1_000_000, availableMinor: 0 })).toHaveLength(0);
  });

  it('requires a known funding source for cash in', () => {
    expect(validateDraft({ ...cashIn, fundingSource: undefined })[0]?.field).toBe('fundingSource');
    expect(validateDraft({ ...cashIn, fundingSource: 'suitcase' })[0]?.field).toBe('fundingSource');
    for (const source of FUNDING_SOURCES) {
      expect(validateDraft({ ...cashIn, fundingSource: source })).toHaveLength(0);
    }
  });

  it('requires destination and beneficiary for cash out', () => {
    expect(
      validateDraft({ ...cashOut, destinationAccount: '' }).some((p) => p.field === 'destinationAccount'),
    ).toBe(true);
    expect(
      validateDraft({ ...cashOut, beneficiaryName: '' }).some((p) => p.field === 'beneficiaryName'),
    ).toBe(true);
  });

  it('bounds the free-text fields', () => {
    expect(validateDraft({ ...cashIn, notes: 'x'.repeat(501) }).some((p) => p.field === 'notes')).toBe(true);
    expect(
      validateDraft({ ...cashIn, reference: 'x'.repeat(121) }).some((p) => p.field === 'reference'),
    ).toBe(true);
  });
});

describe('duplicate submission prevention', () => {
  const draft = { type: 'cash_in' as const, amountMinor: 25_000 };

  it('finds an identical request that is still open', () => {
    expect(findOpenDuplicate([request()], draft)?.code).toBe('WR-ABCD1234');
  });

  it('ignores a decided request of the same shape', () => {
    for (const status of ['completed', 'rejected', 'cancelled'] as const) {
      expect(findOpenDuplicate([request({ status })], draft)).toBeNull();
    }
  });

  it('ignores a request of a different amount, type or currency', () => {
    expect(findOpenDuplicate([request({ amount: 25_001 })], draft)).toBeNull();
    expect(findOpenDuplicate([request({ type: 'cash_out' })], draft)).toBeNull();
    expect(findOpenDuplicate([request({ currency: 'EUR' })], draft)).toBeNull();
  });

  it('treats a different reference as a different transfer', () => {
    // Two $250 pay-ins against two different wires are two real requests.
    const open = [request({ reference: 'wire-8842-A' })];
    expect(findOpenDuplicate(open, { ...draft, reference: 'wire-8843-B' })).toBeNull();
    // The same reference twice is the double-click this guard exists for.
    expect(findOpenDuplicate(open, { ...draft, reference: 'wire-8842-A' })?.code).toBe('WR-ABCD1234');
    // Whitespace-only is no reference at all, and matches the no-reference row.
    expect(findOpenDuplicate([request()], { ...draft, reference: '   ' })?.code).toBe('WR-ABCD1234');
  });

  it('does not flag anything before an amount has been typed', () => {
    expect(findOpenDuplicate([request()], { type: 'cash_in', amountMinor: null })).toBeNull();
  });
});

describe('request search', () => {
  const rows = [
    request({ code: 'WR-AAAA1111', status: 'submitted', amount: 25_000 }),
    request({ id: 'r2', code: 'WR-BBBB2222', type: 'cash_out', status: 'completed', amount: 1_050 }),
  ];

  it('matches everything on an empty query', () => {
    expect(rows.filter((r) => matchesRequestSearch(r, '   '))).toHaveLength(2);
  });

  it('matches by code, status, type and amount', () => {
    expect(rows.filter((r) => matchesRequestSearch(r, 'bbbb'))).toHaveLength(1);
    expect(rows.filter((r) => matchesRequestSearch(r, 'completed'))).toHaveLength(1);
    expect(rows.filter((r) => matchesRequestSearch(r, 'cash_out'))).toHaveLength(1);
    expect(rows.filter((r) => matchesRequestSearch(r, '10.50'))).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    expect(matchesRequestSearch(rows[0]!, 'wr-aaaa1111')).toBe(true);
    expect(matchesRequestSearch(rows[0]!, 'WR-AAAA1111')).toBe(true);
  });
});
