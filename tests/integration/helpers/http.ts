/**
 * Minimal cookie-aware HTTP client for e2e integration tests.
 *
 * These suites run against a LIVE dev server (pnpm dev:api) with a freshly
 * migrated + seeded database. This keeps tests exercising the real HTTP stack,
 * guards, DB transactions, and append-only triggers — end to end.
 */
export const BASE = process.env.API_URL ?? 'http://localhost:3000/api/v1';

export class Client {
  private cookie = '';

  async request(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body: json as any };
  }

  get = (p: string) => this.request('GET', p);
  post = (p: string, b?: unknown) => this.request('POST', p, b);
  patch = (p: string, b?: unknown) => this.request('PATCH', p, b);
  del = (p: string) => this.request('DELETE', p);
}

/** The accounts created by `pnpm --filter @bault/api db:seed`. */
export const SEED_PASSWORD = '11111111';
export const SEED = {
  collector: 'red@bault.dev',
  collector2: 'golden@bault.dev',
  operator: 'hermon@bault.dev',
  admin: 'eldar@bault.dev',
} as const;

/** The same accounts by username — login takes either identifier. */
export const SEED_USERNAME = {
  collector: 'red',
  collector2: 'golden',
  operator: 'hermon',
  admin: 'eldar',
} as const;

/**
 * Sign in a seeded account and return an authenticated client. `identifier` is
 * an email OR a username — login accepts either.
 */
export async function signIn(identifier: string, password = SEED_PASSWORD): Promise<Client> {
  const c = new Client();
  const res = await c.post('/auth/login', { identifier, password });
  if (res.status !== 200)
    throw new Error(`login failed for ${identifier}: ${JSON.stringify(res.body)}`);
  return c;
}

/**
 * The account's OW- routing code. The seed mints these randomly (Requirement
 * 9.1), so tests must look one up rather than hard-code it.
 */
export async function intakeIdOf(email: string): Promise<string> {
  const c = await signIn(email);
  const me = await c.get('/me/profile');
  if (me.status !== 200) throw new Error(`profile lookup failed for ${email}`);
  return me.body.intakeId as string;
}

/** Ids of the seeded bins. Intake requires a bin — it is mandatory (Req 10.3). */
export async function binIds(operator: Client): Promise<string[]> {
  const bins = await operator.get('/custody/bins');
  const ids = (bins.body as { id: string }[]).map((b) => b.id);
  if (ids.length < 2) throw new Error('expected at least two seeded bins');
  return ids;
}

/**
 * Intake one fresh item for a seeded owner, with the mandatory bin filled in.
 * Returns the created item record.
 */
export async function intakeFor(
  operator: Client,
  ownerEmail: string,
  overrides: Record<string, unknown> = {},
) {
  const [ownerIntakeId, bins] = await Promise.all([intakeIdOf(ownerEmail), binIds(operator)]);
  const res = await operator.post('/intake/items', {
    ownerIntakeId,
    typeClass: 'Trading Card',
    binId: bins[0],
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`intake failed: ${JSON.stringify(res.body)}`);
  return res.body;
}
