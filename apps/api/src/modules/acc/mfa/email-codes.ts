import { createHmac, timingSafeEqual } from 'node:crypto';
import { deriveSubkey } from './secret-box';

/*
 * An emailed second-factor code. The worker draws and mails it (apps/worker/src/jobs/mfa-email-code-mail.ts, which
 * repeats `emailCodeKey` and `emailCodeHash` and is pinned to these by tests/worker/mfa-email-code.test.ts); the API
 * only ever compares a typed code with the stored hash. The hash is keyed and names the code's row, so a copy of
 * the table is not a list of a million guesses away from every live code.
 */

export const EMAIL_CODE_DIGITS = 6;

export function emailCodeKey(masterKey: Buffer): Buffer {
  return deriveSubkey(masterKey, 'email-codes');
}

export function emailCodeHash(key: Buffer, codeId: string, code: string): string {
  return createHmac('sha256', key).update(`${codeId}:${code}`).digest('hex');
}

export function emailCodeMatches(key: Buffer, codeId: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(emailCodeHash(key, codeId, code));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A code as typed: spaces and a dash forgiven, anything but six ASCII digits refused. */
export function normalizeEmailCode(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '');
  return new RegExp(`^[0-9]{${EMAIL_CODE_DIGITS}}$`).test(compact) ? compact : null;
}

/** An address shown to somebody who has only proved the password: its first letter and its domain. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${address.slice(0, 1)}•••${address.slice(at)}`;
}
