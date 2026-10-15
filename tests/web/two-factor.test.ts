import { describe, it, expect } from 'vitest';
import { mustEnrolSecondFactor, typedCode } from '../../apps/web/src/shared/twoFactor';

/**
 * The two rules the app applies to two-factor sign-in on its own, as pure
 * functions: who is held on the enrolment screen, and what a typed code is.
 */
describe('who is held on the enrolment screen', () => {
  it('trusts the sign-in response until the profile has answered', () => {
    expect(mustEnrolSecondFactor({ mfaEnrollmentRequired: true })).toBe(true);
    expect(mustEnrolSecondFactor({ mfaEnrollmentRequired: false })).toBe(false);
    // A response that says nothing — an older API, a collector — holds nobody.
    expect(mustEnrolSecondFactor({})).toBe(false);
  });

  it('then goes by the profile: required and not yet enabled', () => {
    expect(mustEnrolSecondFactor({ mfaRequired: true, mfaEnabled: false })).toBe(true);
    expect(mustEnrolSecondFactor({ mfaRequired: true, mfaEnabled: true })).toBe(false);
    expect(mustEnrolSecondFactor({ mfaRequired: false, mfaEnabled: false })).toBe(false);
    // The profile is newer than the sign-in response it replaced.
    expect(mustEnrolSecondFactor({ mfaEnrollmentRequired: true, mfaRequired: true, mfaEnabled: true })).toBe(false);
  });
});

describe('a code as typed', () => {
  it('loses the space authenticator apps show in the middle, and any around it', () => {
    expect(typedCode('123 456')).toBe('123456');
    expect(typedCode(' 123456 ')).toBe('123456');
    expect(typedCode('123 456')).toBe('123456');
  });
});
