import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../apps/web/src/shared/api';
import { loadProfile, resetProfileRequest } from '../../apps/web/src/shared/session';

/**
 * The Vite log reported the failed profile call twice — `(x2)` — because React
 * StrictMode runs the boot effect twice in development. The fix is here, not in
 * StrictMode: concurrent callers share one request.
 */
const realFetch = globalThis.fetch;
let calls: string[];

beforeEach(() => {
  calls = [];
  resetProfileRequest();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetProfileRequest();
  vi.restoreAllMocks();
});

function stubProfile(respond: () => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return respond();
  }) as typeof fetch;
}

/** Shaped like the real `GET /me/profile`: two name parts, no display name. */
const PROFILE = {
  id: 'u1',
  role: 'admin',
  email: 'eldar@bault.dev',
  username: 'eldar',
  firstName: 'Eldar',
  lastName: 'Cohen',
  fullName: 'Eldar Cohen',
  nameReviewRequired: false,
};

function ok(body: unknown, delayMs = 0): () => Promise<Response> {
  return async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

describe('loadProfile', () => {
  it('issues a single request for two concurrent callers (StrictMode double effect)', async () => {
    stubProfile(ok(PROFILE, 10));

    const [a, b] = await Promise.all([loadProfile(), loadProfile()]);

    expect(calls).toEqual(['/api/v1/me/profile']);
    expect(a).toEqual(PROFILE);
    expect(b).toBe(a);
  });

  it('shares the failure with both callers without doubling the request', async () => {
    stubProfile(async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new TypeError('Failed to fetch');
    });

    const results = await Promise.allSettled([loadProfile(), loadProfile()]);

    expect(calls).toHaveLength(1);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
      expect(((result as PromiseRejectedResult).reason as ApiError).kind).toBe('unreachable');
    }
  });

  it('does NOT cache across time — a retry really hits the API again', async () => {
    stubProfile(ok(PROFILE));

    await loadProfile();
    await loadProfile();

    expect(calls).toHaveLength(2);
  });

  it('retries after a failure instead of replaying the stale rejection', async () => {
    let attempt = 0;
    globalThis.fetch = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(PROFILE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await expect(loadProfile()).rejects.toBeInstanceOf(ApiError);
    await expect(loadProfile()).resolves.toEqual(PROFILE);
    expect(attempt).toBe(2);
  });

  it('surfaces 401 as unauthenticated so the app shows sign-in, not an error page', async () => {
    stubProfile(async () =>
      new Response(JSON.stringify({ error: { code: 'unauthenticated', message: 'Authentication required' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const error = (await loadProfile().catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('unauthenticated');
  });
});
