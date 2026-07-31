import { describe, it, expect } from 'vitest';
import { Client, SEED, SEED_PASSWORD, SEED_USERNAME } from './helpers/http';

/**
 * US1 — suspended/closed accounts are blocked (T025).
 *
 * This suite documents the expected behavior; enabling the ADM status-change
 * endpoint (Phase 11) lets it suspend an account first. Until then it asserts the
 * unauthenticated-block path, which shares the same guard.
 */
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

  // TODO(Phase 11): admin suspends a collector → their next request returns
  // 403 account_suspended, proving the SessionAuthGuard status check.
});
