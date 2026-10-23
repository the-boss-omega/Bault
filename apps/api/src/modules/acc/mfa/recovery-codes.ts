import { createHmac, randomInt } from 'node:crypto';

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const LENGTH = 12;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = '';
    for (let i = 0; i < LENGTH; i += 1) raw += ALPHABET[randomInt(ALPHABET.length)];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`);
  }
  return [...codes];
}

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
