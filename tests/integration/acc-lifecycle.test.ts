import { createHash, randomBytes } from 'node:crypto';
import { afterAll, describe, it, expect } from 'vitest';
import { Client, SEED, fixtureEmail, signIn } from './helpers/http';
import { CURRENT_TERMS_VERSION } from '../../apps/api/src/modules/acc/terms';
import { closeDb, sql } from './helpers/db';
import { MFA_PASSWORD, activeAccount, challenge, codeAt, enrol, passwordOnly } from './helpers/mfa';

afterAll(closeDb);

describe('ACC account lifecycle', () => {
  it('registers a new account in pending state with its chosen username and name', async () => {
    const c = new Client();
    const stamp = Date.now();
    const res = await c.post('/auth/register', {
      email: fixtureEmail('lifecycle'),
      username: `t${stamp}`,
      firstName: 'Lifecycle',
      lastName: 'Fixture',
      password: 'password123',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_verification');
    expect(res.body.username).toBe(`t${stamp}`);
    expect(res.body.firstName).toBe('Lifecycle');
    expect(res.body.lastName).toBe('Fixture');
  });

  it('rejects a registration with no username (username is mandatory)', async () => {
    const c = new Client();
    const res = await c.post('/auth/register', {
      email: fixtureEmail('no-username'),
      firstName: 'No',
      lastName: 'Username',
      password: 'password123',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a registration with no name (both parts are mandatory)', async () => {
    const c = new Client();
    const res = await c.post('/auth/register', {
      email: fixtureEmail('no-name'),
      username: `n${Date.now()}`,
      password: 'password123',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate username', async () => {
    const c = new Client();
    const res = await c.post('/auth/register', {
      email: fixtureEmail('duplicate-username'),
      username: 'red',
      firstName: 'Duplicate',
      lastName: 'Username',
      password: 'password123',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });
    expect(res.status).toBe(400);
  });

  it('signs a seeded active account in and returns its identity', async () => {
    const c = await signIn(SEED.collector);
    const me = await c.get('/me/profile');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(SEED.collector);
    expect(me.body.username).toBe('red');
  });

  it('never lets a username be changed once registered (Requirement 4.1)', async () => {
    const c = await signIn(SEED.collector);
    const res = await c.patch('/me/profile', {
      firstName: 'Red',
      lastName: 'Ashwood',
      username: 'someone-else',
    });
    expect(res.status).toBe(400);
    const me = await c.get('/me/profile');
    expect(me.body.username).toBe('red');
  });

  it('changes password and revokes the session on logout', async () => {
    const c = await signIn(SEED.collector2);
    const change = await c.post('/auth/password/change', {
      currentPassword: '11111111',
      newPassword: '11111111',
    });
    expect(change.status).toBe(200);

    const out = await c.post('/auth/logout');
    expect(out.status).toBe(204);
    const after = await c.get('/me/profile');
    expect(after.status).toBe(401);
  });

  it('rejects an invalid verification token as expired/used', async () => {
    const c = new Client();
    const res = await c.post('/auth/verify-email', { token: 'not-a-real-token' });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('token_expired');
  });
});

async function resetLink(userId: string): Promise<string> {
  const raw = randomBytes(32).toString('hex');
  await sql(
    `INSERT INTO verification_token (user_id, type, token_hash, expires_at)
     VALUES ($1, 'password_reset', $2, now() + interval '1 hour')`,
    [userId, createHash('sha256').update(raw).digest('hex')],
  );
  return raw;
}

const resetWith = (token: string, newPassword: string) =>
  new Client().post('/auth/password/reset', { token, newPassword });

describe('a new password', () => {
  it('spends every other reset link the account was mailed', async () => {
    const account = await activeAccount('resetall');
    const first = await resetLink(account.id);
    const second = await resetLink(account.id);

    const used = await resetWith(first, 'a brand new password');
    expect(used.status, JSON.stringify(used.body)).toBe(200);
    const stale = await resetWith(second, 'an attacker password');
    expect(stale.status).toBe(410);
    expect(stale.body.error.code).toBe('token_expired');
    await expect(signIn(account.username, 'a brand new password')).resolves.toBeDefined();
  });

  it('spends the reset links when the password is changed from the profile', async () => {
    const account = await activeAccount('resetchg');
    const link = await resetLink(account.id);
    const c = await passwordOnly(account);
    const change = await c.post('/auth/password/change', {
      currentPassword: MFA_PASSWORD,
      newPassword: 'a changed password',
    });
    expect(change.status, JSON.stringify(change.body)).toBe(200);
    expect((await resetWith(link, 'an attacker password')).status).toBe(410);
    await expect(signIn(account.username, 'a changed password')).resolves.toBeDefined();
  });

  it('withdraws a sign-in that passed the old password and waits for its second factor', async () => {
    for (const how of ['reset', 'change'] as const) {
      const account = await activeAccount(`mfapw${how.slice(0, 2)}`);
      const { secret, recoveryCodes } = await enrol(await passwordOnly(account));
      const pending = await challenge(account);

      if (how === 'reset') {
        expect((await resetWith(await resetLink(account.id), 'a brand new password')).status).toBe(200);
      } else {
        const c = new Client();
        const signedIn = await c.post('/auth/login/mfa', { challengeToken: await challenge(account), code: codeAt(secret, 1) });
        expect(signedIn.status, JSON.stringify(signedIn.body)).toBe(200);
        const change = await c.post('/auth/password/change', {
          currentPassword: MFA_PASSWORD,
          newPassword: 'a changed password',
        });
        expect(change.status, JSON.stringify(change.body)).toBe(200);
      }

      const late = await new Client().post('/auth/login/mfa', { challengeToken: pending, recoveryCode: recoveryCodes[0] });
      expect(late.status, `${how}: ${JSON.stringify(late.body)}`).toBeGreaterThanOrEqual(400);
      expect(late.status).toBeLessThan(500);
      const [live] = await sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM mfa_challenge WHERE user_id = $1 AND consumed_at IS NULL`,
        [account.id],
      );
      expect(live!.n, how).toBe(0);
    }
  }, 20_000);

  it('refuses one longer than 256 characters on every route that takes one', async () => {
    const long = 'p'.repeat(257);
    const register = await new Client().post('/auth/register', {
      email: fixtureEmail('longpw'),
      username: `l${Date.now()}`,
      firstName: 'Long',
      lastName: 'Password',
      password: long,
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });
    expect(register.status).toBe(400);
    expect(register.body.error.message).toBe('The password can be at most 256 characters.');

    const account = await activeAccount('longrst');
    const reset = await resetWith(await resetLink(account.id), long);
    expect(reset.status).toBe(400);
    expect(reset.body.error.message).toBe('The new password can be at most 256 characters.');

    const c = await passwordOnly(account);
    const change = await c.post('/auth/password/change', { currentPassword: MFA_PASSWORD, newPassword: long });
    expect(change.status).toBe(400);
    expect(change.body.error.message).toBe('The new password can be at most 256 characters.');
  });

  it('names the field in words when a name is refused at registration', async () => {
    const res = await new Client().post('/auth/register', {
      email: fixtureEmail('ltname'),
      username: `m${Date.now()}`,
      firstName: 'Re<d',
      lastName: 'Ash',
      password: 'password123',
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('The first name cannot contain < or > or control characters.');
  });
});
