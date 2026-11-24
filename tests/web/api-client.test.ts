import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiErrorKey, isUnreachable, onSessionEnded } from '../../apps/web/src/shared/api';
import { getAllPages } from '../../apps/web/src/shared/paging';

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
  onSessionEnded(null);
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
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const error = await api.get('/me/profile').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('unreachable');
    expect((error as ApiError).status).toBe(0);
    expect(isUnreachable(error)).toBe(true);
    expect((error as ApiError).message).toBe('Card Embassy could not be reached. Check your connection and try again.');
    expect((error as ApiError).message).not.toMatch(/fetch/i);
  });

  it('treats the dev proxy 503 envelope as unreachable too', async () => {
    stubFetch(() =>
      jsonResponse(503, {
        error: { code: 'api_unreachable', message: 'The Card Embassy API is unavailable at http://127.0.0.1:3000.' },
      }),
    );

    const error = (await api.get('/me/profile').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('unreachable');
    expect(error.status).toBe(503);
    expect(apiErrorKey(error)).toBe('error.unreachable');
    expect(error.message).not.toMatch(/127\.0\.0\.1|API is unavailable/);
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

describe('api client — plain words for a failure the reader cannot act on', () => {
  it.each([
    [500, 'Internal server error'],
    [502, 'Bad Gateway'],
    [503, 'Service Unavailable'],
  ])('shows the catalogue sentence for HTTP %i, never the server text "%s"', async (status, raw) => {
    stubFetch(() => jsonResponse(status, { error: { code: 'internal', message: raw } }));
    const error = (await api.get('/wallet/me').catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe('The server failed to answer. Try again in a moment.');
  });

  it('shows the catalogue sentence when a proxy answers 502 with no envelope', async () => {
    stubFetch(() => new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }));
    const error = (await api.get('/wallet/me').catch((e: unknown) => e)) as ApiError;
    expect(error.message).not.toMatch(/Bad Gateway|HTTP 502/);
  });
});

describe('api client — a session that ends after the app has loaded', () => {
  it('hands any 401 to the one session-ended handler and says to sign in again', async () => {
    const ended = vi.fn();
    onSessionEnded(ended);
    stubFetch(() => jsonResponse(401, { error: { code: 'unauthenticated', message: 'Authentication required' } }));
    const error = (await api.post('/wallet/cash-in', {}).catch((e: unknown) => e)) as ApiError;
    expect(ended).toHaveBeenCalledTimes(1);
    expect(error.kind).toBe('unauthenticated');
    expect(error.message).toBe('Your session ended, sign in again.');
  });

  it('leaves a wrong password on the sign-in form alone', async () => {
    const ended = vi.fn();
    onSessionEnded(ended);
    stubFetch(() => jsonResponse(401, { error: { code: 'unauthenticated', message: 'That email or username and password do not match.' } }));
    const error = (await api.post('/auth/login', {}).catch((e: unknown) => e)) as ApiError;
    expect(ended).not.toHaveBeenCalled();
    expect(error.message).toBe('That email or username and password do not match.');
  });

  it('does nothing extra before boot, when no handler is set', async () => {
    stubFetch(() => jsonResponse(401, { error: { code: 'unauthenticated', message: 'Authentication required' } }));
    const error = (await api.get('/me/profile').catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe('unauthenticated');
  });
});

describe('getAllPages — every row, however many pages', () => {
  it('asks for the largest page and follows the cursor until a short page', async () => {
    const rows = Array.from({ length: 1_120 }, (_, i) => ({ id: `i${i}` }));
    stubFetch((url) => {
      const params = new URL(url, 'http://x').searchParams;
      const cursor = params.get('cursor');
      const limit = Number(params.get('limit'));
      const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
      return jsonResponse(200, rows.slice(start, start + limit));
    });
    const all = await getAllPages<{ id: string }>('/vault/items?scope=active');
    expect(all).toHaveLength(1_120);
    expect(calls).toEqual([
      '/api/v1/vault/items?scope=active&limit=500',
      '/api/v1/vault/items?scope=active&limit=500&cursor=i499',
      '/api/v1/vault/items?scope=active&limit=500&cursor=i999',
    ]);
  });

  it('starts the query string itself when the path has none', async () => {
    stubFetch(() => jsonResponse(200, []));
    await getAllPages('/vault/items');
    expect(calls).toEqual(['/api/v1/vault/items?limit=500']);
  });
});
