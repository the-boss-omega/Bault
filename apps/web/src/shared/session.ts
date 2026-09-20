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
   * `active` or `suspended`. A suspended account CAN now sign in — it just
   * cannot do anything except use the helpdesk, which is what lets somebody
   * locked out for debt ask to be let back in. The shell keys its restricted
   * view off this, so it has to travel with the profile.
   */
  status: string;
  email: string;
  /** Permanent, unique, customer-facing. Never changes after registration. */
  username: string;
  firstName: string | null;
  lastName: string | null;
  /**
   * Derived by the API from the two parts above and sent for convenience. The
   * SPA still derives its own with `fullName()` wherever it renders a name, so
   * a stale or missing value can never put a wrong name on screen.
   */
  fullName: string;
  /** True while a migrated legacy name is still awaiting confirmation. */
  nameReviewRequired: boolean;
}

/**
 * In-flight request, shared by every concurrent caller.
 *
 * React StrictMode runs effects twice in development on purpose (to surface
 * effects that are not idempotent), which previously fired TWO `/me/profile`
 * requests on every boot — the `(x2)` in the Vite proxy log. Collapsing
 * overlapping calls onto one promise fixes the duplicate at its source, without
 * disabling StrictMode and without a mount-guard ref that would also swallow a
 * legitimate second load.
 *
 * Only *concurrent* calls share: once the request settles the slot is cleared,
 * so a later retry (or a reload after sign-in) really does hit the network.
 */
let inFlight: Promise<SessionProfile> | null = null;

export function loadProfile(): Promise<SessionProfile> {
  if (inFlight) return inFlight;

  const pending = api.get<SessionProfile>('/me/profile');
  inFlight = pending;
  // Clear the slot once settled. The extra `.catch` keeps this bookkeeping
  // chain from becoming an unhandled rejection — the caller handles the error.
  void pending
    .finally(() => {
      if (inFlight === pending) inFlight = null;
    })
    .catch(() => undefined);

  return pending;
}

/** Drop any shared in-flight request (used by tests and after sign-out). */
export function resetProfileRequest(): void {
  inFlight = null;
}

/** Fired on `window` when the signed-in person's own profile changed, so the shell re-reads it. */
export const PROFILE_CHANGED = 'bault:profile-changed';
