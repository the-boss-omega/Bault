import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '@bault/config';

/**
 * The API's own media URLs: `/api/v1/media/object?key=…&exp=…&sig=…`.
 *
 * The same shape as a presigned S3 URL, for the same reason — an `<img src>`
 * carries no Authorization header, so everything needed to read the object is
 * in the query string, and it stops working at `exp`. The signature is an
 * HMAC over the key and the expiry with `SESSION_COOKIE_SECRET`, which the env
 * schema already requires and which nothing outside the API ever sees.
 */
export const MEDIA_OBJECT_PATH = '/api/v1/media/object';

function mac(key: string, expiresAt: number): string {
  return createHmac('sha256', loadEnv().SESSION_COOKIE_SECRET)
    .update(`${key}\n${expiresAt}`, 'utf8')
    .digest('base64url');
}

export function signMediaKey(key: string, expiresAt: number): string {
  return mac(key, expiresAt);
}

/** True when `sig` was minted for this key and expiry, and the expiry has not passed. */
export function verifyMediaKey(key: string, expiresAt: number, sig: string): boolean {
  if (!key || !Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(mac(key, expiresAt));
  const given = Buffer.from(sig ?? '');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
