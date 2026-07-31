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
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
