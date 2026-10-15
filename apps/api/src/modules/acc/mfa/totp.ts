import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226), HMAC-SHA1, 30-second
 * steps, six digits — the parameters every authenticator app defaults to, and
 * the only ones this server accepts.
 *
 * Written against `node:crypto` rather than taken from a package. The whole
 * algorithm is an HMAC and a dynamic truncation; a dependency would bring more
 * code than it replaces, and the published test vectors (pinned in
 * `tests3/contract/mfa-crypto.test.ts`) are a better guarantee than a version
 * number. Everything here is pure, so it is tested without a server.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps either side of now that still count, for a phone whose clock is a little off. */
export const TOTP_WINDOW = 1;
/** RFC 4226 §4 recommends a 160-bit shared secret for HMAC-SHA1. */
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A fresh random secret. */
export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** RFC 4648 base32, upper case, unpadded — what authenticator apps expect to be typed. */
export function base32Encode(data: Buffer): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Base32 back to bytes, forgiving what a person does when copying it by hand —
 * lower case, spaces, the padding some apps show — and nothing else.
 */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const index = BASE32_ALPHABET.indexOf(ch);
    if (index === -1) throw new Error('Not a base32 string');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * HOTP (RFC 4226 §5.3): HMAC-SHA1 over the counter as eight big-endian bytes,
 * dynamic truncation to 31 bits, the last `digits` decimal digits.
 */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The RFC 6238 time step `nowMs` falls in. */
export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code an authenticator shows at `nowMs`. */
export function totp(secret: Buffer, nowMs: number, digits = TOTP_DIGITS): string {
  return hotp(secret, timeStep(nowMs), digits);
}

/**
 * The step whose code this is, if it is one inside the window, else `null`.
 *
 * Returning the STEP rather than a yes/no is what replay protection needs: the
 * caller records the step it accepted and refuses any later code for that step
 * or an earlier one. A code is only ever six ASCII digits — anything else is
 * refused before any HMAC is computed, so a stray space or a full-width digit
 * cannot be the reason two inputs compare differently.
 */
export function matchTotp(secret: Buffer, code: string, nowMs: number, window = TOTP_WINDOW): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  const now = timeStep(nowMs);
  let matched: number | null = null;
  // Every candidate is computed and compared, in constant time, whichever
  // matches: how long a refusal takes says nothing about how close it was.
  for (let step = now - window; step <= now + window; step += 1) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  return matched;
}

/**
 * The provisioning URI an authenticator reads from the QR code (the Key URI
 * format Google Authenticator defined and every app follows). The parameters
 * are spelled out even though they are the defaults, so an app that defaults
 * differently is told what this server checks.
 */
export function otpauthUri({ issuer, account, secret }: { issuer: string; account: string; secret: Buffer }): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
