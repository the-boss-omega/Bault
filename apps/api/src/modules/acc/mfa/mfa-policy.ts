import { loadEnv } from '@bault/config';
import type { Role } from '../../sec/auth-context';

/**
 * Who must sign in with a second factor — `MFA_REQUIRED_ROLES`, read once.
 *
 * A provider rather than a `loadEnv()` call inside the guard, so the guard can
 * be built with any policy in a test and its rule pinned without depending on
 * what configuration a running API happened to start with. The config schema
 * decides the default (staff in production, nobody elsewhere) and refuses a
 * production list that leaves either staff role out.
 */
export const MFA_POLICY = 'MFA_POLICY';

export interface MfaPolicy {
  requiredRoles: readonly Role[];
}

export const mfaPolicyProvider = {
  provide: MFA_POLICY,
  useFactory: (): MfaPolicy => ({ requiredRoles: loadEnv().MFA_REQUIRED_ROLES }),
};
