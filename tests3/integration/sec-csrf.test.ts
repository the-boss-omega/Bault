import { describe, expect, it } from 'vitest';
import { BASE, SEED, SEED_PASSWORD, signIn } from '../../tests/integration/helpers/http';

/**
 * Cross-site requests (E8).
 *
 * The API decoded `application/x-www-form-urlencoded` bodies as well as JSON,
 * so a plain HTML form on any site reached it: `POST /auth/login` from a
 * stranger's page signed the visitor's browser into the stranger's account
 * (login CSRF), and `SameSite=Lax` does nothing about that, nor about a page on
 * another subdomain of the same site. Nothing looked at `Origin` at all.
 *
 * Raw `fetch` here rather than the suite's `Client`, because the whole point is
 * the headers a browser would send and that client does not.
 */

const APP_ORIGIN = new URL(process.env.APP_BASE_URL ?? 'http://localhost:5173').origin;

/** The API's problem envelope, or whatever a successful route returned. */
type ProblemOr<T> = T & { error: { code: string; message: string } };

async function raw(
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: string | FormData } = {},
) {
  const res = await fetch(BASE + path, { method, headers: init.headers, body: init.body });
  const body = (await res.json().catch(() => null)) as ProblemOr<Record<string, unknown>>;
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') };
}

const cookieOf = (client: Awaited<ReturnType<typeof signIn>>) =>
  (client as unknown as { cookie: string }).cookie;

describe('a body that is not JSON', () => {
  it('cannot sign anybody in from an HTML form', async () => {
    const res = await raw('POST', '/auth/login', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identifier: SEED.collector, password: SEED_PASSWORD }).toString(),
    });
    expect([400, 415]).toContain(res.status);
    expect(res.setCookie ?? '').not.toMatch(/=[0-9a-f]{16,}/);
  });

  it('cannot sign anybody in as multipart either', async () => {
    const form = new FormData();
    form.set('identifier', SEED.collector);
    form.set('password', SEED_PASSWORD);
    const res = await raw('POST', '/auth/login', { body: form });
    expect([400, 415]).toContain(res.status);
  });

  it('cannot reach a route that needs no body, which no DTO would have caught', async () => {
    // `enctype="text/plain"` is the third thing a form can send. A route with no
    // body to validate ran on it regardless — here, signing the person out of
    // every other device.
    const collector = await signIn(SEED.collector);
    const res = await raw('POST', '/auth/sessions/revoke-others', {
      headers: { 'content-type': 'text/plain', cookie: cookieOf(collector) },
      body: 'x=1',
    });
    expect(res.status).toBe(415);
  });
});

describe('the Origin a browser sends', () => {
  it('refuses a state-changing request from another site', async () => {
    const res = await raw('POST', '/auth/login', {
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ identifier: SEED.collector, password: SEED_PASSWORD }),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('accepts the same request from the app’s own origin', async () => {
    const res = await raw('POST', '/auth/login', {
      headers: { 'content-type': 'application/json', origin: APP_ORIGIN },
      body: JSON.stringify({ identifier: SEED.collector, password: SEED_PASSWORD }),
    });
    expect(res.status).toBe(200);
  });

  it('refuses the opaque origin a sandboxed frame sends', async () => {
    // `Origin: null` is what a sandboxed iframe or a `data:` page sends — an
    // attacker's easiest way to post without naming their own site.
    const res = await raw('POST', '/auth/login', {
      headers: { 'content-type': 'application/json', origin: 'null' },
      body: JSON.stringify({ identifier: SEED.collector, password: SEED_PASSWORD }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses a foreign origin on a signed-in route, and leaves the session alone', async () => {
    const collector = await signIn(SEED.collector);
    const res = await raw('POST', '/auth/logout', {
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: cookieOf(collector) },
    });
    expect(res.status).toBe(403);
    expect((await collector.get('/me/profile')).status).toBe(200);
  });

  it('does not get in the way of reading', async () => {
    const collector = await signIn(SEED.collector);
    const res = await raw('GET', '/me/profile', {
      headers: { origin: 'https://evil.example', cookie: cookieOf(collector) },
    });
    expect(res.status).toBe(200);
  });

  it('lets a request with no Origin through — curl, a server, this suite', async () => {
    const res = await raw('POST', '/auth/login', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: SEED.collector, password: SEED_PASSWORD }),
    });
    expect(res.status).toBe(200);
  });
});

describe('the payment provider’s callback', () => {
  it('is exempt from the Origin rule and still reaches verification', async () => {
    // A provider is not a browser and owes us no particular Origin. What stands
    // between this route and the internet is the adapter's signature check —
    // the sandbox adapter accepts any JSON, which is why it is refused in
    // production.
    const res = await raw('POST', '/webhooks/payment', {
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ id: `evt_csrf_${Date.now()}`, type: 'topup.settled', data: {} }),
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
  });

  it('still verifies a delivery with no Origin', async () => {
    const res = await raw('POST', '/webhooks/payment', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: `evt_plain_${Date.now()}`, type: 'topup.settled', data: {} }),
    });
    expect(res.status).toBe(201);
  });
});
