import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { Client, SEED, signIn } from './helpers/http';
import { closeDb } from './helpers/db';
import { MFA_PASSWORD, activeAccount, challenge, codeAt, enrol, type Account } from './helpers/mfa';

let child: ChildProcess | null = null;
let base = '';
let output = '';
const promoted: string[] = [];

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}/api/v1`;
  child = spawn(process.execPath, [join(process.cwd(), 'apps/api/dist/main.js')], {
    cwd: process.cwd(),
    env: { ...process.env, MFA_REQUIRED_ROLES: 'admin,warehouse_operator', API_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (output += String(d)));
  child.stderr?.on('data', (d) => (output += String(d)));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/readyz`);
      if (res.ok) return;
    } catch {
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the API requiring two-factor sign-in did not start:\n${output.slice(-2000)}`);
}, 90_000);

afterAll(async () => {
  child?.kill('SIGTERM');
  const admin = await signIn(SEED.admin);
  for (const id of promoted) await admin.patch(`/admin/users/${id}`, { role: 'user' });
  await closeDb();
});

async function staff(label: string, role: 'admin' | 'warehouse_operator'): Promise<Account> {
  const account = await activeAccount(label);
  const admin = await signIn(SEED.admin);
  const res = await admin.patch(`/admin/users/${account.id}`, { role });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  promoted.push(account.id);
  return account;
}

async function signedInThere(account: Account): Promise<{ client: Client; body: Record<string, unknown> }> {
  const client = new Client(base);
  const res = await client.post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { client, body: res.body };
}

describe('a member of staff who has not enrolled', () => {
  it('can sign in, is told to enrol, and can do nothing else until they have', async () => {
    const operator = await staff('mfaop', 'warehouse_operator');
    const { client, body } = await signedInThere(operator);
    expect(body).toMatchObject({ role: 'warehouse_operator', mfaEnrollmentRequired: true });

    for (const path of ['/custody/bins', '/finance/wallet', '/vault/items']) {
      const res = await client.get(path);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe('mfa_enrollment_required');
    }
    const write = await client.patch('/me/profile', { firstName: 'Changed', lastName: 'Name' });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('mfa_enrollment_required');

    const me = await client.get('/me/profile');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ role: 'warehouse_operator', mfaRequired: true, mfaEnabled: false });
    const status = await client.get('/auth/mfa');
    expect(status.body).toMatchObject({ enabled: false, required: true });

    await enrol(client);
    expect((await client.get('/custody/bins')).status).toBe(200);
  });

  it('can always sign out', async () => {
    const admin = await staff('mfaad', 'admin');
    const { client, body } = await signedInThere(admin);
    expect(body.mfaEnrollmentRequired).toBe(true);
    expect((await client.get('/admin/users')).body.error.code).toBe('mfa_enrollment_required');
    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/me/profile')).status).toBe(401);
  });

  it('cannot turn it off again once enrolled', async () => {
    const operator = await staff('mfaopoff', 'warehouse_operator');
    const { client } = await signedInThere(operator);
    const { secret } = await enrol(client);
    const res = await client.post('/auth/mfa/disable', { password: MFA_PASSWORD, code: codeAt(secret, 1) });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('mfa_required_for_role');
    expect((await client.get('/auth/mfa')).body.enabled).toBe(true);
  });
});

describe('the same API', () => {
  it('asks nothing extra of a collector', async () => {
    const collector = await activeAccount('mfacol');
    const { client, body } = await signedInThere(collector);
    expect(body.mfaEnrollmentRequired).toBe(false);
    expect((await client.get('/finance/wallet')).status).toBe(200);
  });

  it('lets one code open one session even when two API processes are asked at once', async () => {
    const account = await activeAccount('mfaxproc');
    const { secret } = await enrol(await signedInThere(account).then((s) => s.client));
    const here = await challenge(account);
    const there = await challenge(account, base);
    const code = codeAt(secret, 1);
    const results = await Promise.all([
      new Client().post('/auth/login/mfa', { challengeToken: here, code }),
      new Client(base).post('/auth/login/mfa', { challengeToken: there, code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});
