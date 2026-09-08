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
  /**
   * Added because it was missing, which made the two PUT routes
   * (`/notifications/preferences` and `.../channel`) structurally untestable —
   * no suite could reach them, so nothing did.
   */
  put = (p: string, b?: unknown) => this.request('PUT', p, b);
  del = (p: string) => this.request('DELETE', p);
}

/**
 * Where accounts created BY TESTS live.
 *
 * These suites register real accounts against a real database. Minting them at
 * `bault.dev` — the seeded personas' domain — left them sitting in the
 * product-facing Management > Users table, indistinguishable from customers.
 * `.test` is reserved by RFC 2606, so this domain can never be a real address,
 * and `AdmService.listUsers` filters it out by exact domain match.
 *
 * Mirrors `FIXTURE_EMAIL_DOMAIN` in `apps/api/src/shared/fixtures.ts`; matched
 * by value so the test tree and the API stay independent.
 */
export const FIXTURE_EMAIL_DOMAIN = 'fixture.bault.test';

/** A unique fixture address. `label` only aids debugging a failed run. */
export function fixtureEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${FIXTURE_EMAIL_DOMAIN}`;
}

/** The accounts created by `pnpm --filter @bault/api db:seed`. */
export const SEED_PASSWORD = '11111111';
export const SEED = {
  collector: 'red@bault.dev',
  collector2: 'golden@bault.dev',
  /**
   * A third collector, seeded as a PRE-IDENTITY-PASS account: it carries a legacy
   * OW- intake ID, its migrated name is flagged for review, and its original
   * single display name is kept read-only. Tests use it both as an ordinary
   * third party and to prove the migrated-account paths still work.
   */
  collector3: 'veteran@bault.dev',
  operator: 'hermon@bault.dev',
  admin: 'eldar@bault.dev',
} as const;

/** The same accounts by username — login takes either identifier. */
export const SEED_USERNAME = {
  collector: 'red',
  collector2: 'golden',
  collector3: 'veteran',
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
 * The account's permanent USERNAME — the customer-facing identifier every
 * workflow names an account by.
 *
 * This replaced `intakeIdOf`. The OW- intake code is retired from user-facing
 * APIs and `/me/profile` no longer returns one, so a test that needs to name an
 * owner asks for the username exactly as an operator would.
 */
export async function usernameOf(email: string): Promise<string> {
  const c = await signIn(email);
  const me = await c.get('/me/profile');
  if (me.status !== 200) throw new Error(`profile lookup failed for ${email}`);
  return me.body.username as string;
}

/**
 * Put money in a wallet the only way the platform allows: raise a cash-in
 * REQUEST as the customer, then have an administrator approve and complete it.
 *
 * Tests used to call `POST /finance/wallet/topups` and have the balance move on
 * the spot. That capability no longer exists for anyone — submitting a request
 * changes nothing, and only a completed request writes a ledger row — so a test
 * that needs a funded wallet has to walk the real approval path. That the helper
 * is this long is the point: there is no shortcut, including for tests.
 *
 * `customerEmail` must not be the admin's own account: separation of duties bars
 * an administrator from deciding a request they raised themselves.
 */
export async function fundWallet(customerEmail: string, amountMinor: number): Promise<void> {
  if (customerEmail === SEED.admin) {
    throw new Error(
      'fundWallet cannot fund the admin account: an admin may not approve their own wallet request.',
    );
  }
  const customer = await signIn(customerEmail);
  const created = await customer.post('/finance/wallet-requests', {
    type: 'cash_in',
    amountMinor,
    currency: 'USD',
    fundingSource: 'bank_transfer',
    // Unique per call, so two fundings of the same amount are not refused as
    // duplicates of one another.
    reference: `test-funding-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  });
  if (created.status !== 201) {
    throw new Error(`cash-in request failed: ${JSON.stringify(created.body)}`);
  }
  const requestId = created.body.id as string;

  const admin = await signIn(SEED.admin);
  const approved = await admin.post(`/admin/wallet-requests/${requestId}/approve`, {});
  if (approved.status !== 201) {
    throw new Error(`approve failed: ${JSON.stringify(approved.body)}`);
  }
  const completed = await admin.post(`/admin/wallet-requests/${requestId}/complete`, {});
  if (completed.status !== 201) {
    throw new Error(`complete failed: ${JSON.stringify(completed.body)}`);
  }
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
  // Routed by USERNAME, exactly as the warehouse intake form does it now.
  const [ownerUsername, bins] = await Promise.all([usernameOf(ownerEmail), binIds(operator)]);
  const res = await operator.post('/intake/items', {
    ownerUsername,
    typeClass: 'trading_card',
    binId: bins[0],
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`intake failed: ${JSON.stringify(res.body)}`);
  return res.body;
}
