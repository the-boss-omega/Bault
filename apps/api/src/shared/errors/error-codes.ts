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
  /**
   * The card is already promised elsewhere — in an open escrow deal, a parcel
   * being prepared, or a buyout or consignment — so it cannot also be sold.
   * Distinct from ITEM_ON_HOLD: nothing is wrong with the card, it is spoken for.
   */
  ITEM_COMMITTED: 'item_committed',
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
  /**
   * The payment provider failed or could not be reached (502). Its own code so
   * a PayPal outage or a refused payout is told apart from a bug in Bault.
   */
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  /**
   * The object store failed or could not be reached (503). Its own code so an
   * operator can tell a store outage, which trying again later fixes, from an
   * internal error.
   */
  STORAGE_UNAVAILABLE: 'storage_unavailable',
  /**
   * Signed in, but this account's role requires a second factor and none is
   * enrolled yet (403). Every route answers this except enrolment, sign-out and
   * the profile probe, so the client can send the person to enrol rather than
   * show them a console that refuses everything with a bare "forbidden".
   */
  MFA_ENROLLMENT_REQUIRED: 'mfa_enrollment_required',
  /** A wrong, reused or malformed second-factor code or recovery code. */
  MFA_CODE_INVALID: 'mfa_code_invalid',
  /**
   * The sign-in challenge is unknown, used, expired or burned by wrong codes
   * (401). The remedy is the same in every case — enter the password again —
   * so the cases are not told apart.
   */
  MFA_CHALLENGE_EXPIRED: 'mfa_challenge_expired',
  MFA_ALREADY_ENABLED: 'mfa_already_enabled',
  MFA_NOT_ENABLED: 'mfa_not_enabled',
  /** Turning two-factor sign-in off, for a role that must keep it (403). */
  MFA_REQUIRED_FOR_ROLE: 'mfa_required_for_role',
  /** The stored two-factor secret cannot be opened, for example after a key change (409). */
  MFA_FACTOR_UNREADABLE: 'mfa_factor_unreadable',
  /** Requeue of an outbox message that is not parked — delivered, or still being retried. */
  OUTBOX_NOT_PARKED: 'outbox_not_parked',
  INTERNAL: 'internal',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
