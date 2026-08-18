import { describe, expect, it } from 'vitest';
import { BASE, SEED, signIn } from './helpers/http';

/**
 * The local-development contract between the SPA and the API.
 *
 * These assertions are the ones that were violated when the web app booted
 * against a backend nobody had started: the frontend asks `/api/v1/me/profile`
 * on first paint, and `pnpm dev` gates on `/api/v1/healthz` before it lets Vite
 * start. Both must behave exactly as the orchestration assumes.
 *
 * Runs against a live API (`pnpm dev` or `pnpm dev:api`) with a seeded database,
 * like every other suite in tests/integration.
 */
const ORIGIN = new URL(BASE).origin;
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}

/** The Vite dev server is optional — only `pnpm dev:api` is required to run these. */
const webUp = await reachable(WEB_URL);

describe('dev readiness endpoints', () => {
  it('serves liveness without a session (the readiness gate has no cookie)', async () => {
    const res = await fetch(`${BASE}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('serves readiness without a session and reports the database', async () => {
    const res = await fetch(`${BASE}/readyz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: true });
  });

  it('binds a loopback IPv4 address, so 127.0.0.1 is a valid proxy target', async () => {
    const res = await fetch(`http://127.0.0.1:${new URL(ORIGIN).port}/api/v1/healthz`);
    expect(res.status).toBe(200);
  });
});

describe('GET /me/profile — the SPA boot request', () => {
  it('answers 401 with the error envelope when no session cookie is sent', async () => {
    const res = await fetch(`${BASE}/me/profile`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthenticated' } });
  });

  it('returns the signed-in profile when the session cookie is sent', async () => {
    const client = await signIn(SEED.admin);
    const res = await client.get('/me/profile');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: SEED.admin, role: 'admin' });
  });
});

// Skipped rather than failed when only the API is running — the suite must not
// depend on a second process being up, and must not sleep waiting for one.
describe.skipIf(!webUp)('through the Vite dev proxy', () => {
  it('proxies /api/v1/healthz from the web origin to the API', async () => {
    const res = await fetch(`${WEB_URL}/api/v1/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('proxies /api/v1/me/profile and forwards the session cookie both ways', async () => {
    const login = await fetch(`${WEB_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: SEED.admin, password: '11111111' }),
    });
    expect(login.status).toBe(200);

    const setCookie = login.headers.get('set-cookie');
    expect(setCookie, 'the proxy must pass Set-Cookie back to the browser').toBeTruthy();
    // No Domain rewrite: the cookie must stay host-only for the dev origin.
    expect(setCookie?.toLowerCase()).not.toContain('domain=');

    const profile = await fetch(`${WEB_URL}/api/v1/me/profile`, {
      headers: { cookie: setCookie!.split(';')[0]! },
    });
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({ email: SEED.admin, role: 'admin' });
  });

  it('answers 401 (not a connection error) for an unauthenticated proxied call', async () => {
    const res = await fetch(`${WEB_URL}/api/v1/me/profile`);
    expect(res.status).toBe(401);
  });
});
