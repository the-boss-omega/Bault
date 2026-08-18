import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiErrorKey, isUnreachable } from '../../apps/web/src/shared/api';

/**
 * The SPA must be able to tell "the backend is not there" apart from "the
 * backend says you are not signed in". Collapsing the two is what turned a dead
 * API into a sign-in screen — a silent, misleading sign-out.
 */
const realFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let calls: string[];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
}

describe('api client — request shape', () => {
  it('calls the versioned prefix and sends the session cookie', async () => {
    let received: RequestInit | undefined;
    stubFetch((_url, init) => {
      received = init;
      return jsonResponse(200, { id: 'u1' });
    });

    await api.get('/me/profile');

    expect(calls).toEqual(['/api/v1/me/profile']);
    expect(received?.credentials).toBe('include');
  });

  it('returns null for 204 without trying to parse a body', async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(api.del('/me/addresses/a1')).resolves.toBeNull();
  });
});

describe('api client — failure classification', () => {
  it('reports a refused connection as unreachable, not as a server error', async () => {
    // fetch rejects (never resolves with a status) when no socket can be opened.
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const error = await api.get('/me/profile').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('unreachable');
    expect((error as ApiError).status).toBe(0);
    expect(isUnreachable(error)).toBe(true);
  });

  it('treats the dev proxy 503 envelope as unreachable too', async () => {
    // What apps/web/vite.config.ts answers when it cannot reach the API.
    stubFetch(() =>
      jsonResponse(503, {
        error: { code: 'api_unreachable', message: 'The Bault API is unavailable at http://127.0.0.1:3000.' },
      }),
    );

    const error = (await api.get('/me/profile').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('unreachable');
    expect(error.status).toBe(503);
    expect(apiErrorKey(error)).toBe('error.unreachable');
  });

  it.each([
    [401, 'unauthenticated', 'error.unauthenticated'],
    [403, 'forbidden', 'error.forbidden'],
    [404, 'not_found', 'error.notFound'],
    [500, 'server', 'error.server'],
    [503, 'server', 'error.server'],
  ] as const)('maps HTTP %i to %s', async (status, kind, messageKey) => {
    stubFetch(() => jsonResponse(status, { error: { code: 'x', message: 'nope' } }));

    const error = (await api.get('/me/profile').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(apiErrorKey(error)).toBe(messageKey);
    expect(isUnreachable(error)).toBe(false);
  });

  it('keeps the API message for an ordinary 4xx so validation stays specific', async () => {
    stubFetch(() =>
      jsonResponse(409, { error: { code: 'conflict', message: 'Address label already used' } }),
    );

    const error = (await api.get('/me/addresses').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('client');
    expect(error.message).toBe('Address label already used');
    expect(apiErrorKey(error)).toBeNull();
  });

  it('falls back to the status text when the body is not the error envelope', async () => {
    stubFetch(() => new Response('<html>Internal Server Error</html>', { status: 500 }));

    const error = (await api.get('/me/profile').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('server');
    expect(error.message).toBeTruthy();
  });

  it('makes exactly one attempt — a refused connection is never auto-retried', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    await api.get('/me/profile').catch(() => undefined);
    expect(calls).toHaveLength(1);
  });
});
