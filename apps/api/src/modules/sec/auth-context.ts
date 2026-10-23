export type Role = 'user' | 'warehouse_operator' | 'admin';
export type AccountStatus = 'pending' | 'active' | 'suspended' | 'closed';

export interface AuthUser {
  id: string;
  role: Role;
  status: AccountStatus;
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
