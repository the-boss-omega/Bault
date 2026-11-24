import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { Client, SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';
import {
  MFA_PASSWORD,
  activeAccount,
  challenge,
  codeAt,
  deliverCodes,
  emailChallenge,
  enrol,
  enrolByEmail,
  mailedCode,
  type Account,
} from './helpers/mfa';

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

  it('lets one emailed code open one session even when two API processes are asked at once', async () => {
    const account = await activeAccount('emxproc');
    await enrolByEmail(await signedInThere(account).then((s) => s.client), account);
    const here = await emailChallenge(account);
    const there = await emailChallenge(account, base);
    const code = await mailedCode(account);
    const results = await Promise.all([
      new Client().post('/auth/login/mfa', { challengeToken: here.token, code }),
      new Client(base).post('/auth/login/mfa', { challengeToken: there.token, code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});

describe('email codes and a role that must use an authenticator', () => {
  it('are not offered to staff, and are refused if asked for', async () => {
    const operator = await staff('emop', 'warehouse_operator');
    const { client } = await signedInThere(operator);
    expect((await client.get('/auth/mfa')).body).toMatchObject({ required: true, methods: ['totp'] });
    const res = await client.post('/auth/mfa/setup', { method: 'email' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('mfa_method_not_allowed');
    expect(await deliverCodes(operator)).toEqual([]);
  });

  it('do not count for a collector made staff: they are held to set up the app, which then replaces the email codes', async () => {
    const account = await activeAccount('empromo');
    await enrolByEmail(await signedInThere(account).then((s) => s.client), account);
    const admin = await signIn(SEED.admin);
    expect((await admin.patch(`/admin/users/${account.id}`, { role: 'warehouse_operator' })).status).toBe(200);
    promoted.push(account.id);

    const { token } = await emailChallenge(account, base);
    const client = new Client(base);
    const signedIn = await client.post('/auth/login/mfa', { challengeToken: token, code: await mailedCode(account) });
    expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
    expect(signedIn.body).toMatchObject({ role: 'warehouse_operator', mfaEnrollmentRequired: true });

    const blocked = await client.get('/custody/bins');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('mfa_enrollment_required');
    expect((await client.get('/me/profile')).body).toMatchObject({ mfaEnabled: true, mfaMethod: 'email', mfaRequired: true });
    expect((await client.get('/auth/mfa')).body).toMatchObject({ enabled: true, method: 'email', methods: ['totp'] });

    const off = await client.post('/auth/mfa/disable', { password: MFA_PASSWORD, code: '000000' });
    expect(off.status).toBe(403);

    const { secret } = await enrol(client);
    expect((await client.get('/custody/bins')).status).toBe(200);
    const factors = await sql<{ method: string }>(`SELECT method FROM mfa_factor WHERE user_id = $1`, [account.id]);
    expect(factors).toEqual([{ method: 'totp' }]);

    const again = await new Client(base).post('/auth/login', { identifier: account.username, password: MFA_PASSWORD });
    expect(again.body).toMatchObject({ status: 'mfa_required', method: 'totp' });
    const ok = await new Client(base).post('/auth/login/mfa', { challengeToken: again.body.challengeToken, code: codeAt(secret, 1) });
    expect(ok.body).toMatchObject({ mfaEnrollmentRequired: false });
  });
});
