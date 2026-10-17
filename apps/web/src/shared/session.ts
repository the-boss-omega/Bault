import { api } from './api';

/**
 * The signed-in account, as returned by `GET /api/v1/me/profile`.
 *
 * This one request answers "who am I" on boot: the session cookie is httpOnly,
 * so the SPA cannot read it and must ask the API instead.
 */
export interface SessionProfile {
  id: string;
  role: string;
  /**
   * `active` or `suspended`. A suspended account can sign in but can only use
   * the helpdesk, so somebody locked out for debt can ask to be let back in.
   * The shell keys its restricted view off this.
   */
  status: string;
  email: string;
  /** Permanent, unique, customer-facing. Never changes after registration. */
  username: string;
  firstName: string | null;
  lastName: string | null;
  /**
   * Derived by the API from the two parts above. The SPA derives its own with
   * `fullName()` wherever it renders a name, so a stale value never shows.
   */
  fullName: string;
  /** True while a migrated legacy name is still awaiting confirmation. */
  nameReviewRequired: boolean;
  /** The account has a confirmed second factor. */
  mfaEnabled: boolean;
  /**
   * Its role requires one. `mfaRequired && !mfaEnabled` is an account every
   * route but enrolment refuses; see `mustEnrolSecondFactor`.
   */
  mfaRequired: boolean;
}

/**
 * In-flight request, shared by every concurrent caller, so StrictMode's double
 * effect run in development sends one `/me/profile` request, not two.
 *
 * Only concurrent calls share: once the request settles the slot is cleared,
 * so a later retry (or a reload after sign-in) hits the network.
 */
let inFlight: Promise<SessionProfile> | null = null;

export function loadProfile(): Promise<SessionProfile> {
  if (inFlight) return inFlight;

  const pending = api.get<SessionProfile>('/me/profile');
  inFlight = pending;
  // Clear the slot once settled. The extra `.catch` keeps this bookkeeping
  // chain from becoming an unhandled rejection; the caller handles the error.
  void pending
    .finally(() => {
      if (inFlight === pending) inFlight = null;
    })
    .catch(() => undefined);

  return pending;
}

/** Drop any shared in-flight request (used by tests, and on sign-in, enrolment and sign-out). */
export function resetProfileRequest(): void {
  inFlight = null;
}
