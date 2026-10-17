/**
 * The two rules about two-factor sign-in that the app applies itself.
 *
 * Pure, so `tests/web/two-factor.test.ts` pins them without a browser. The API
 * is the authority on both: it refuses an unenrolled member of staff on every
 * route and rejects a malformed code. These only keep the app from rendering
 * screens that would fail, or sending a code the way it was displayed.
 */

/** What the shell knows about an account's second factor at any moment. */
export interface SecondFactorFacts {
  /** From the sign-in response, before the profile has loaded. */
  mfaEnrollmentRequired?: boolean;
  /** From `/me/profile`, which replaces the sign-in response once it arrives. */
  mfaRequired?: boolean;
  mfaEnabled?: boolean;
}

/**
 * True for an account the API will refuse everything until it enrols, which the
 * shell holds on the enrolment screen. The profile wins once it is there: it is
 * the newer answer, and the one that changes when enrolment finishes.
 */
export function mustEnrolSecondFactor(user: SecondFactorFacts): boolean {
  if (user.mfaRequired !== undefined || user.mfaEnabled !== undefined) {
    return Boolean(user.mfaRequired) && !user.mfaEnabled;
  }
  return Boolean(user.mfaEnrollmentRequired);
}

/** A code as an authenticator displays it ("123 456") reduced to what the API checks. */
export function typedCode(input: string): string {
  return input.replace(/\s/g, '');
}
