import { createHmac, randomInt } from 'node:crypto';

/**
 * Recovery codes: the way back in when the phone is gone.
 *
 * Ten, each usable once, shown exactly once: when two-factor sign-in is
 * switched on, or when the set is replaced. Only a keyed hash of each is kept,
 * so nobody, an administrator with the database included, can read them back
 * later; somebody who lost them asks for a new set (which needs a current code)
 * or for an administrator to reset their two-factor sign-in.
 *
 * Twelve characters from Crockford's base32 alphabet (no I, L, O or U, the
 * letters people misread as digits or as each other) in three groups of four:
 * sixty bits, copied by hand without ambiguity. Typing one back is forgiving
 * in the same way: any case, with or without the dashes or spaces, and an O, I
 * or L is read as the digit it was mistaken for.
 *
 * Hashed with HMAC under a key derived from `MFA_ENCRYPTION_KEY`, not plain
 * SHA-256: with the key out of reach a leaked table is sixty bits per code to
 * guess blind, and with a plain hash it would be sixty bits to guess offline at
 * the speed of a GPU.
 */

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const LENGTH = 12;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = '';
    // randomInt is uniform over the range, so no character is likelier than another.
    for (let i = 0; i < LENGTH; i += 1) raw += ALPHABET[randomInt(ALPHABET.length)];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`);
  }
  return [...codes];
}

/** The canonical twelve characters, or `null` if this cannot be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const compact = input
    .toLowerCase()
    .replace(/[\s-]/g, '')
    .replace(/o/g, '0')
    .replace(/[il]/g, '1');
  if (compact.length !== LENGTH) return null;
  for (const ch of compact) if (!ALPHABET.includes(ch)) return null;
  return compact;
}

export function hashRecoveryCode(key: Buffer, normalized: string): string {
  return createHmac('sha256', key).update(normalized).digest('hex');
}
