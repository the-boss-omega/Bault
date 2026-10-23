import { createHash, randomBytes } from 'node:crypto';
import { afterAll, describe, it, expect } from 'vitest';
import { Client, SEED, SEED_PASSWORD, SEED_USERNAME, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

describe('ACC account-status blocking', () => {
  it('blocks unauthenticated access to protected routes', async () => {
    const c = new Client();
    const res = await c.get('/me/profile');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('rejects login with wrong credentials without leaking which field is wrong', async () => {
    const c = new Client();
    const res = await c.post('/auth/login', { identifier: SEED.collector, password: 'wrong-pass' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('signs in with a username just as well as with an email', async () => {
    const byUsername = await new Client().post('/auth/login', {
      identifier: SEED_USERNAME.collector,
      password: SEED_PASSWORD,
    });
    expect(byUsername.status).toBe(200);

    const byEmail = await new Client().post('/auth/login', {
      identifier: SEED.collector,
      password: SEED_PASSWORD,
    });
    expect(byEmail.status).toBe(200);
    expect(byUsername.body.id).toBe(byEmail.body.id);
  });
});

describe('ACC signing out, whatever the account status', () => {
  async function fixtureAccount(): Promise<string> {
    const tag = randomBytes(5).toString('hex');
    const email = `signout-${tag}@fixture.bault.test`;
    await sql(
      `INSERT INTO user_account (email, username, password_hash, status, role, first_name, last_name, terms_version, terms_accepted_at)
       SELECT $1, $2, password_hash, 'active', 'user', 'Signout', 'Fixture', terms_version, terms_accepted_at
         FROM user_account WHERE email = $3`,
      [email, `so${tag}`, SEED.collector],
    );
    return email;
  }

  for (const status of ['suspended', 'closed'] as const) {
    it(`ends the session of a ${status} account`, async () => {
      const email = await fixtureAccount();
      const client = await signIn(email);
      const cookie = (client as unknown as { cookie: string }).cookie;
      const tokenHash = createHash('sha256').update(cookie.slice(cookie.indexOf('=') + 1)).digest('hex');

      await sql(`UPDATE user_account SET status = $2 WHERE email = $1`, [email, status]);
      expect((await client.get('/vault/items')).status).toBe(403);

      const out = await client.post('/auth/logout');
      expect(out.status).toBe(204);
      const [session] = await sql<{ revoked: boolean }>(
        `SELECT revoked_at IS NOT NULL AS revoked FROM login_session WHERE token_hash = $1`,
        [tokenHash],
      );
      expect(session?.revoked).toBe(true);
    });
  }
});
