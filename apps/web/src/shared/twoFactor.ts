export interface SecondFactorFacts {
  mfaEnrollmentRequired?: boolean;
  mfaRequired?: boolean;
  mfaEnabled?: boolean;
}

export function mustEnrolSecondFactor(user: SecondFactorFacts): boolean {
  if (user.mfaRequired !== undefined || user.mfaEnabled !== undefined) {
    return Boolean(user.mfaRequired) && !user.mfaEnabled;
  }
  return Boolean(user.mfaEnrollmentRequired);
}

export function typedCode(input: string): string {
  return input.replace(/\s/g, '');
}
