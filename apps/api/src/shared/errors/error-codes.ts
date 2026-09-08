/**
 * Canonical error codes (T013). Mirrors the codes documented in
 * contracts/README.md so clients can branch on a stable string, not a message.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'validation_failed',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  ACCOUNT_SUSPENDED: 'account_suspended',
  TOKEN_EXPIRED: 'token_expired',
  /**
   * Credentials were right; the address has never been confirmed.
   *
   * Distinct from FORBIDDEN because it is the one sign-in refusal with a
   * remedy the person can carry out themselves, and the client can only offer
   * that remedy if it can tell this case apart from every other 403.
   */
  EMAIL_UNVERIFIED: 'email_unverified',
  ITEM_ON_HOLD: 'item_on_hold',
  ITEM_NO_LONGER_AVAILABLE: 'item_no_longer_available',
  SELF_DEALING_FORBIDDEN: 'self_dealing_forbidden',
  INSUFFICIENT_BALANCE: 'insufficient_balance',
  NEGATIVE_BALANCE_BLOCKED: 'negative_balance_blocked',
  IDEMPOTENCY_KEY_REUSED: 'idempotency_key_reused',
  DUAL_CONSENT_REQUIRED: 'dual_consent_required',
  CONFIRMATION_REQUIRED: 'confirmation_required',
  /** Too many requests in the window. Clients should back off and retry. */
  RATE_LIMITED: 'rate_limited',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  INTERNAL: 'internal',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
