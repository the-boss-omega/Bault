import { ApiError, apiErrorKey } from './api';
import type { MessageKey, TranslateFn } from './i18n';

/**
 * The API's own sentences for the failures people hit most, in the reader's
 * language.
 *
 * The API answers in English. A validation or conflict message is usually the
 * most specific thing there is to show, so it is shown as it comes — but the
 * handful below are what a person sees on the sign-in and account screens, and
 * "Invalid credentials" on a Hebrew page reads as the product not being finished.
 */
const KNOWN: Record<string, MessageKey> = {
  'Invalid credentials': 'error.invalidCredentials',
  'Email is already registered': 'error.emailTaken',
  'Current password is incorrect': 'error.currentPasswordWrong',
};

/** What to put on screen for a failed call. */
export function errorText(t: TranslateFn, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const known = KNOWN[message];
  if (known) return t(known);
  const key = apiErrorKey(error);
  if (key) return t(key);
  // A field-level validation message from the API is English-only; in Hebrew
  // say what to do rather than show a sentence the reader may not read.
  if (document.documentElement.lang === 'he' && error instanceof ApiError && error.kind === 'client' && /[a-z]/i.test(message)) {
    return t('error.checkFields');
  }
  return message;
}
