import { useEffect, useState } from 'react';
import type { TranslateFn } from './i18n';

export type MfaMethod = 'totp' | 'email';

export interface SecondFactorFacts {
  mfaEnrollmentRequired?: boolean;
  mfaRequired?: boolean;
  mfaEnabled?: boolean;
  mfaMethod?: MfaMethod | null;
}

/** A role that requires two-factor sign-in requires the authenticator app: emailed codes do not count for it. */
export function mustEnrolSecondFactor(user: SecondFactorFacts): boolean {
  if (user.mfaRequired !== undefined || user.mfaEnabled !== undefined) {
    return Boolean(user.mfaRequired) && (!user.mfaEnabled || user.mfaMethod === 'email');
  }
  return Boolean(user.mfaEnrollmentRequired);
}

export function typedCode(input: string): string {
  return input.replace(/\s/g, '');
}

/** Whole seconds from `now` until `at` (a time in milliseconds), never below nothing. */
export function secondsLeft(at: number | null, now: number): number {
  if (at === null) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * The seconds left before another code may be asked for, counted down once a second. `at` is when that becomes
 * allowed, or null when it already is.
 */
export function useSecondsUntil(at: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (at === null || at <= Date.now()) return undefined;
    // design-lint-allow: not motion, a countdown of whole seconds to a time a minute or so away; it stops there.
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= at) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [at]);
  return secondsLeft(at, now);
}

/** How long until another code may be asked for, said in seconds, or in minutes once it is more than a minute and a half. */
export function waitText(t: TranslateFn, seconds: number): string {
  return seconds > 90 ? t('mfa.email.waitMinutes', { minutes: Math.ceil(seconds / 60) }) : t('mfa.email.wait', { seconds });
}
