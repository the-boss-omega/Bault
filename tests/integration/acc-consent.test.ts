import { describe, it, expect } from 'vitest';
import { Client, SEED, fixtureEmail, signIn } from './helpers/http';
import { CURRENT_TERMS_VERSION } from '../../apps/api/src/modules/acc/terms';

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
    expect(res.body.termsVersion).toBe(CURRENT_TERMS_VERSION);
    const acceptedAt = Date.parse(res.body.termsAcceptedAt);
    expect(Number.isFinite(acceptedAt)).toBe(true);
    expect(acceptedAt).toBeGreaterThanOrEqual(before - 5_000);
    expect(acceptedAt).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('shows an account that predates the consent step as never having accepted', async () => {
    const collector = await signIn(SEED.collector);
    const me = await collector.get('/me/profile');
    expect(me.status).toBe(200);
    expect(me.body).toHaveProperty('termsVersion', null);
    expect(me.body).toHaveProperty('termsAcceptedAt', null);
  });
});
