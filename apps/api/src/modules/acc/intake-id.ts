import { randomInt } from 'node:crypto';

/**
 * Generates a human-usable unique Owner ID for the intake context (e.g. "OW-7F3K9Q").
 * Uniqueness is ultimately enforced by the DB unique index; the caller retries on the
 * rare collision. Ambiguous characters (0/O, 1/I) are excluded for warehouse readability.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateIntakeId(): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `OW-${suffix}`;
}
