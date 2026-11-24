import { createHmac, timingSafeEqual } from 'node:crypto';
import { deriveSubkey } from './secret-box';

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

export function normalizeEmailCode(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '');
  return new RegExp(`^[0-9]{${EMAIL_CODE_DIGITS}}$`).test(compact) ? compact : null;
}

export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${address.slice(0, 1)}•••${address.slice(at)}`;
}
