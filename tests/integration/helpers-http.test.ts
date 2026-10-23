import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, signIn } from './helpers/http';
import { closeDb } from './helpers/db';
import { MFA_PASSWORD, activeAccount, enrol, passwordOnly } from './helpers/mfa';

let server: Server;
let seen: string[] = [];
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.url ?? '');
    res.writeHead(200, { 'Content-Type': 'text/csv' });
    res.end('a,b\n1,2\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});

describe('Client.getText', () => {
  it('asks the server the client was made for, not the one under API_URL', async () => {
    seen = [];
    const res = await new Client(base).getText('/admin/accounting/ledger.csv');
    expect(seen).toEqual(['/api/v1/admin/accounting/ledger.csv']);
    expect(res.status).toBe(200);
    expect(res.text).toBe('a,b\n1,2\n');
  });
});

describe('signIn', () => {
  it('refuses to hand back a client for an account that was asked for a second factor', async () => {
    const account = await activeAccount('helper');
    await enrol(await passwordOnly(account));

    await expect(signIn(account.username, MFA_PASSWORD)).rejects.toThrow(/second factor/i);
  });
});
