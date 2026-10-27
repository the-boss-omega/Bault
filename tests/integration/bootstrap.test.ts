import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, it, expect } from 'vitest';
import { closeDb, sql } from './helpers/db';
import { Client, SEED, SEED_PASSWORD, SEED_USERNAME } from './helpers/http';

afterAll(closeDb);

const ROOT = join(__dirname, '..', '..');
const API_DIR = join(ROOT, 'apps', 'api');
const CREATE_ADMIN = join(API_DIR, 'src', 'db', 'create-admin.ts');
const TSX = pathToFileURL(createRequire(join(API_DIR, 'package.json')).resolve('tsx')).href;

function createAdmin(args: string[], password: string) {
  const r = spawnSync(process.execPath, ['--import', TSX, CREATE_ADMIN, ...args], {
    cwd: ROOT,
    env: process.env,
    input: `${password}\n`,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

const everyAccount = () =>
  sql(`SELECT id, email, username, password_hash, status, role, first_name, last_name
         FROM user_account ORDER BY id`);

describe('the first-administrator command', () => {
  it('refuses, naming the administrator who exists, and changes no account', async () => {
    const before = await everyAccount();

    const r = createAdmin(
      ['--email', 'second@example.com', '--username', 'second', '--first-name', 'Second', '--last-name', 'Admin'],
      'a long enough password',
    );

    expect(r.status).not.toBe(0);
    expect(r.output).toContain('Refusing to create an administrator');
    expect(r.output).toContain(`${SEED_USERNAME.admin} <${SEED.admin}>`);
    expect(await everyAccount()).toEqual(before);
  }, 60_000);
});

describe('the platform custodian', () => {
  it('is the one closed account migration 0038 writes, and cannot sign in', async () => {
    const rows = await sql<{ username: string; status: string; role: string }>(
      `SELECT username, status, role FROM user_account WHERE email = 'platform@bault.dev'`,
    );
    expect(rows).toEqual([{ username: 'platform', status: 'closed', role: 'user' }]);

    for (const identifier of ['platform@bault.dev', 'platform']) {
      const res = await new Client().post('/auth/login', { identifier, password: SEED_PASSWORD });
      expect(res.status, identifier).toBe(401);
    }
  });
});
