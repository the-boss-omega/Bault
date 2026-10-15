/**
 * Shared authentication context (SEC).
 *
 * `AuthUser` is what an authenticated request carries (populated by ACC's session
 * guard). Augmenting Express.Request.user gives every handler typed access.
 */
export type Role = 'user' | 'warehouse_operator' | 'admin';
export type AccountStatus = 'pending' | 'active' | 'suspended' | 'closed';

export interface AuthUser {
  id: string;
  role: Role;
  status: AccountStatus;
  /**
   * Whether the account has a confirmed second factor. Set by the session
   * guard on every request, read by `MfaEnrollmentGuard`; absent on a user
   * object that did not come from a session, which that guard treats as "not
   * enrolled" rather than guessing.
   */
  mfaEnabled?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
