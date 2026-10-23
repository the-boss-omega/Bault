import { loadEnv } from '@bault/config';
import type { Role } from '../../sec/auth-context';

export const MFA_POLICY = 'MFA_POLICY';

export interface MfaPolicy {
  requiredRoles: readonly Role[];
}

export const mfaPolicyProvider = {
  provide: MFA_POLICY,
  useFactory: (): MfaPolicy => ({ requiredRoles: loadEnv().MFA_REQUIRED_ROLES }),
};
