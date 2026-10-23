import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function verifyToken(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(raw));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
