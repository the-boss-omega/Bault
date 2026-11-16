import { describe, it, expect } from 'vitest';
import { mustEnrolSecondFactor, secondsLeft, typedCode } from '../../apps/web/src/shared/twoFactor';

describe('who is held on the enrolment screen', () => {
  it('trusts the sign-in response until the profile has answered', () => {
    expect(mustEnrolSecondFactor({ mfaEnrollmentRequired: true })).toBe(true);
    expect(mustEnrolSecondFactor({ mfaEnrollmentRequired: false })).toBe(false);
    expect(mustEnrolSecondFactor({})).toBe(false);
  });

  it('then goes by the profile: required and not yet enabled', () => {
    expect(mustEnrolSecondFactor({ mfaRequired: true, mfaEnabled: false })).toBe(true);
    expect(mustEnrolSecondFactor({ mfaRequired: true, mfaEnabled: true })).toBe(false);
    expect(mustEnrolSecondFactor({ mfaRequired: false, mfaEnabled: false })).toBe(false);
    expect(mustEnrolSecondFactor({ mfaEnrollmentRequired: true, mfaRequired: true, mfaEnabled: true })).toBe(false);
  });

  it('holds a member of staff whose second factor is emailed codes, which their role does not accept', () => {
    expect(mustEnrolSecondFactor({ mfaRequired: true, mfaEnabled: true, mfaMethod: 'email' })).toBe(true);
    expect(mustEnrolSecondFactor({ mfaRequired: true, mfaEnabled: true, mfaMethod: 'totp' })).toBe(false);
    expect(mustEnrolSecondFactor({ mfaRequired: false, mfaEnabled: true, mfaMethod: 'email' })).toBe(false);
  });
});

describe('the wait before another code can be asked for', () => {
  it('counts whole seconds down to nothing', () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 20_000)).toBe(0);
    expect(secondsLeft(null, 0)).toBe(0);
  });
});

describe('a code as typed', () => {
  it('loses the space authenticator apps show in the middle, and any around it', () => {
    expect(typedCode('123 456')).toBe('123456');
    expect(typedCode(' 123456 ')).toBe('123456');
    expect(typedCode('123 456')).toBe('123456');
  });
});
