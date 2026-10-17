import { randomInt } from 'node:crypto';

/**
 * Generates a human-usable Owner ID for the intake context (e.g. "OW-7F3K9Q").
 * Registration does not allocate one (the username is the customer-facing
 * identifier), so nothing calls this; uniqueness rests on the DB unique index.
 * Ambiguous characters (0/O, 1/I) are excluded for warehouse readability.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateIntakeId(): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `OW-${suffix}`;
}
