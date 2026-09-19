import { applyDecorators, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

/**
 * Put a route in the small `auth` rate-limit bucket.
 *
 * `@nestjs/throttler` v6 applies EVERY named throttler to EVERY route: a
 * `@Throttle({ auth })` on a handler only changes that handler's numbers, it
 * does not make the other routes exempt. So the `auth` bucket — 30 a minute by
 * default, meant for sign-in and mail-sending routes — was capping every
 * request in the API per IP, and the generous `default` bucket could never
 * bind. A collector browsing the marketplace, or an operator scanning a stack
 * at the bench, was locked out after thirty requests in a minute.
 *
 * Now the `auth` throttler skips any route that doesn't carry this marker
 * (`skipsAuthBucket`, wired in `app.module.ts`), and the credential and mail
 * routes opt in with this decorator.
 */
export const AUTH_BUCKET = 'bault:auth-bucket';

export function AuthBucket(limit: number, ttl = 60_000) {
  return applyDecorators(SetMetadata(AUTH_BUCKET, true), Throttle({ auth: { limit, ttl } }));
}

/** `skipIf` for the `auth` throttler: skip every route that did not opt in. */
export function skipsAuthBucket(context: ExecutionContext): boolean {
  return Reflect.getMetadata(AUTH_BUCKET, context.getHandler()) !== true;
}
