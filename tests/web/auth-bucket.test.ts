import '../../apps/api/node_modules/reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '../../apps/api/node_modules/@nestjs/common';
import { AuthBucket, skipsAuthBucket } from '../../apps/api/src/modules/acc/auth-bucket.decorator';

/**
 * `@nestjs/throttler` v6 applies every named throttler to every route, so the
 * small `auth` bucket (meant for sign-in and mail routes) was capping the whole
 * API at 30 requests a minute per IP. The `auth` throttler now skips any route
 * not marked `@AuthBucket`. Proven live on a second API instance with
 * AUTH_RATE_LIMIT_PER_MINUTE=3: ten public requests all 200; sign-in 401 ×3
 * then 429.
 */
class Routes {
  @AuthBucket(3)
  signIn() {}

  browse() {}
}

const contextFor = (handler: () => void) => ({ getHandler: () => handler }) as unknown as ExecutionContext;

describe('the auth rate-limit bucket', () => {
  it('applies to routes that opt in', () => {
    expect(skipsAuthBucket(contextFor(Routes.prototype.signIn))).toBe(false);
  });

  it('is skipped by every other route', () => {
    expect(skipsAuthBucket(contextFor(Routes.prototype.browse))).toBe(true);
  });
});
