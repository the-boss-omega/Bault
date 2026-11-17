export type Role = 'user' | 'warehouse_operator' | 'admin';
export type AccountStatus = 'pending' | 'active' | 'suspended' | 'closed';
export type MfaMethod = 'totp' | 'email';

export interface AuthUser {
  id: string;
  role: Role;
  status: AccountStatus;
  mfaEnabled?: boolean;
  /** The second factor in force, when there is one. A role that requires two-factor sign-in accepts only `totp`. */
  mfaMethod?: MfaMethod | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
