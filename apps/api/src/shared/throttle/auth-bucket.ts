import { applyDecorators, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

const AUTH_BUCKET = 'bault:auth-bucket';

/**
 * Count this route against the small `auth` budget, at this many per minute.
 *
 * Every named throttler applies to every route unless something says
 * otherwise. The `auth` budget is meant for sign-in and mail-sending only, so
 * routes opt in here and the `auth` throttler skips the rest (`notAnAuthRoute`).
 */
export function AuthBucket(limit: number) {
  return applyDecorators(SetMetadata(AUTH_BUCKET, true), Throttle({ auth: { limit, ttl: 60_000 } }));
}

/** The `auth` throttler's `skipIf`: true for every route that did not opt in. */
export function notAnAuthRoute(context: ExecutionContext): boolean {
  return Reflect.getMetadata(AUTH_BUCKET, context.getHandler()) !== true;
}
