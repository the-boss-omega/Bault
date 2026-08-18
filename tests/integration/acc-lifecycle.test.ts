import { describe, it, expect } from 'vitest';
import { Client, SEED, fixtureEmail, signIn } from './helpers/http';

/**
 * US1 / Scenario A — account lifecycle (T024).
 * Requires a running API + seeded DB.
 */
describe('ACC account lifecycle', () => {
  it('registers a new account in pending state with its chosen username and name', async () => {
    const c = new Client();
    const stamp = Date.now();
    // Registered in the reserved fixture domain, so the account this test
    // creates never surfaces in the product-facing Users table.
    const res = await c.post('/auth/register', {
      email: fixtureEmail('lifecycle'),
      username: `t${stamp}`,
      firstName: 'Lifecycle',
      lastName: 'Fixture',
      password: 'password123',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_verification');
    // The customer-facing identifier is the username; intake IDs are retired and
    // new accounts never get one.
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
    });
    expect(res.status).toBe(400);
  });

  it('rejects a registration with no name (both parts are mandatory)', async () => {
    const c = new Client();
    const res = await c.post('/auth/register', {
      email: fixtureEmail('no-name'),
      username: `n${Date.now()}`,
      password: 'password123',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate username', async () => {
    const c = new Client();
    const res = await c.post('/auth/register', {
      email: fixtureEmail('duplicate-username'),
      username: 'red', // already taken by the seeded collector
      firstName: 'Duplicate',
      lastName: 'Username',
      password: 'password123',
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
    // UpdateProfileDto whitelists the two name parts only, and the global
    // ValidationPipe runs with forbidNonWhitelisted — so a username field is
    // rejected outright.
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
      newPassword: '11111111', // no-op change; still must succeed
    });
    expect(change.status).toBe(200);

    const out = await c.post('/auth/logout');
    expect(out.status).toBe(204);
    const after = await c.get('/me/profile');
    expect(after.status).toBe(401); // session revoked
  });

  it('rejects an invalid verification token as expired/used', async () => {
    const c = new Client();
    const res = await c.post('/auth/verify-email', { token: 'not-a-real-token' });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('token_expired');
  });
});
