export type Role = 'user' | 'warehouse_operator' | 'admin';
export type AccountStatus = 'pending' | 'active' | 'suspended' | 'closed';
export type MfaMethod = 'totp' | 'email';

export interface AuthUser {
  id: string;
  role: Role;
  status: AccountStatus;
  mfaEnabled?: boolean;
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
