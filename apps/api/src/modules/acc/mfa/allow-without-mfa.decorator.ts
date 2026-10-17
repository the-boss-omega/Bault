import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route an account may reach before it has enrolled a second factor
 * its role requires.
 *
 * An administrator or operator who has not enrolled can sign in (otherwise
 * they could never enrol), and `MfaEnrollmentGuard` then refuses every route
 * they ask for with `mfa_enrollment_required`, except these: the enrolment
 * routes themselves, sign-out, and `GET /me/profile`, the probe the app shell
 * needs to know who is signed in and to send them to the enrolment screen.
 *
 * Applied to exactly those, and `tests3/contract/mfa-enforcement.test.ts` pins
 * the list by reading the source: one stray mark on a payout route would
 * quietly reopen what the requirement closes.
 */
export const ALLOW_WITHOUT_MFA_KEY = 'allow_without_mfa';
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA_KEY, true);
