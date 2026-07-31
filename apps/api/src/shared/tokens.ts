import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque-token helpers used by ACC (verification, password reset, sessions) and
 * the confirmation primitive. We store only the SHA-256 HASH of a token; the raw
 * value exists solely in the emailed link or the httpOnly cookie. This means a
 * database leak never exposes usable tokens.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Constant-time compare of a raw token against a stored hash. */
export function verifyToken(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(raw));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
