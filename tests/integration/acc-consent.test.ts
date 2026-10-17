import { describe, it, expect } from 'vitest';
import { Client, SEED, fixtureEmail, signIn } from './helpers/http';

/**
 * Registration records that the person agreed to the terms.
 *
 * Bault charges fees, accrues interest on a negative balance and suspends
 * accounts, so nobody gets an account without agreeing to that. The API
 * refuses a registration that did not accept, refuses one that accepted some
 * OTHER version than the one in force, and writes down which version and when.
 *
 * The version is spelled out here rather than imported from the API, so a
 * change of version is a deliberate edit in two places, not something a test
 * follows silently. `tests/web/faq-legal.test.ts` checks that the SPA and the
 * API name the same one.
 */
const CURRENT_TERMS_VERSION = '2026-10-draft-1';

function registration(overrides: Record<string, unknown> = {}) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    email: fixtureEmail('consent'),
    username: `c${stamp}`,
    firstName: 'Consent',
    lastName: 'Fixture',
    password: 'password123',
    ...overrides,
  };
}

describe('ACC registration consent', () => {
  it('refuses a registration that did not accept the terms', async () => {
    const res = await new Client().post('/auth/register', registration());
    expect(res.status).toBe(400);
  });

  it('refuses an acceptance that is not a version string', async () => {
    for (const acceptedTermsVersion of [true, '', '   ', 1]) {
      const res = await new Client().post('/auth/register', registration({ acceptedTermsVersion }));
      expect(res.status, `${JSON.stringify(acceptedTermsVersion)} was accepted`).toBe(400);
    }
  });

  it('refuses an acceptance of terms that are not the ones in force', async () => {
    // A page loaded before the terms changed sends the version it showed. That
    // is not consent to the current text, so it is refused with a reason the
    // page can act on rather than recorded as if it were.
    const res = await new Client().post(
      '/auth/register',
      registration({ acceptedTermsVersion: '2020-01-draft-1' }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/terms/i);
    expect(res.body.error.details?.currentVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it('stores the accepted version and the moment it was accepted', async () => {
    const before = Date.now();
    const res = await new Client().post(
      '/auth/register',
      registration({ acceptedTermsVersion: CURRENT_TERMS_VERSION }),
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_verification');
    // Read back from the row as INSERTed (RETURNING), not echoed from the request.
    expect(res.body.termsVersion).toBe(CURRENT_TERMS_VERSION);
    const acceptedAt = Date.parse(res.body.termsAcceptedAt);
    expect(Number.isFinite(acceptedAt)).toBe(true);
    expect(acceptedAt).toBeGreaterThanOrEqual(before - 5_000);
    expect(acceptedAt).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('shows an account that predates the consent step as never having accepted', async () => {
    // The seeded personas were created before there was anything to accept.
    // Their profile says so plainly instead of inventing an acceptance.
    const collector = await signIn(SEED.collector);
    const me = await collector.get('/me/profile');
    expect(me.status).toBe(200);
    expect(me.body).toHaveProperty('termsVersion', null);
    expect(me.body).toHaveProperty('termsAcceptedAt', null);
  });
});
