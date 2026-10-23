import { applyDecorators, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

const AUTH_BUCKET = 'bault:auth-bucket';

export function AuthBucket(limit: number) {
  return applyDecorators(SetMetadata(AUTH_BUCKET, true), Throttle({ auth: { limit, ttl: 60_000 } }));
}

export function notAnAuthRoute(context: ExecutionContext): boolean {
  return Reflect.getMetadata(AUTH_BUCKET, context.getHandler()) !== true;
}
