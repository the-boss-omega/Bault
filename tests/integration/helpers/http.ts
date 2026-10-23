export const BASE = process.env.API_URL ?? 'http://localhost:3000/api/v1';

export class Client {
  private cookie = '';

  constructor(private readonly base: string = BASE) {}

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body: json as any };
  }

  get hasSession(): boolean {
    return this.cookie !== '';
  }

  get = (p: string) => this.request('GET', p);
  post = (p: string, b?: unknown, headers?: Record<string, string>) => this.request('POST', p, b, headers);
  patch = (p: string, b?: unknown) => this.request('PATCH', p, b);
  put = (p: string, b?: unknown) => this.request('PUT', p, b);
  del = (p: string) => this.request('DELETE', p);

  async getText(path: string) {
    const res = await fetch(this.base + path, { headers: this.cookie ? { cookie: this.cookie } : {} });
    return { status: res.status, headers: res.headers, text: await res.text() };
  }
}

export const FIXTURE_EMAIL_DOMAIN = 'fixture.bault.test';

export function fixtureEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${FIXTURE_EMAIL_DOMAIN}`;
}

export const SEED_PASSWORD = '11111111';
export const SEED = {
  collector: 'red@bault.dev',
  collector2: 'golden@bault.dev',
  collector3: 'veteran@bault.dev',
  operator: 'hermon@bault.dev',
  admin: 'eldar@bault.dev',
} as const;

export const SEED_USERNAME = {
  collector: 'red',
  collector2: 'golden',
  collector3: 'veteran',
  operator: 'hermon',
  admin: 'eldar',
} as const;

export async function signIn(identifier: string, password = SEED_PASSWORD, base = BASE): Promise<Client> {
  const c = new Client(base);
  const res = await c.post('/auth/login', { identifier, password });
  if (res.status !== 200)
    throw new Error(`login failed for ${identifier}: ${JSON.stringify(res.body)}`);
  if (res.body?.status === 'mfa_required')
    throw new Error(`login for ${identifier} stopped at the second factor: no session was opened (use ./mfa)`);
  if (!c.hasSession) throw new Error(`login for ${identifier} answered 200 but set no session cookie`);
  return c;
}

export async function usernameOf(email: string): Promise<string> {
  const c = await signIn(email);
  const me = await c.get('/me/profile');
  if (me.status !== 200) throw new Error(`profile lookup failed for ${email}`);
  return me.body.username as string;
}

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

export async function binIds(operator: Client): Promise<string[]> {
  const bins = await operator.get('/custody/bins');
  const ids = (bins.body as { id: string }[]).map((b) => b.id);
  if (ids.length < 2) throw new Error('expected at least two seeded bins');
  return ids;
}

export async function intakeFor(
  operator: Client,
  ownerEmail: string,
  overrides: Record<string, unknown> = {},
) {
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
