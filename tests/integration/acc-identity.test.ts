import { describe, it, expect } from 'vitest';
import { Client, SEED, SEED_USERNAME, fixtureEmail, signIn, usernameOf } from './helpers/http';

/**
 * User identity after the identity pass (Requirements 3 & 4).
 *
 * Three properties, each enforced at more than one layer, each checked here at
 * the layer a user actually meets — the HTTP API:
 *
 *   - a USERNAME is unique, permanent, and cannot be reassigned;
 *   - a person's name is FIRST + LAST, validated, with no display name anywhere;
 *   - the INTAKE ID is gone from every customer-facing response, while remaining
 *     visible to an administrator and still usable for a pre-printed label.
 *
 * Requires a running API + seeded DB.
 */

/** Register a fresh, valid account and return the response. */
async function register(client: Client, overrides: Record<string, unknown> = {}) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return client.post('/auth/register', {
    email: fixtureEmail('identity'),
    username: `t${stamp}`,
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: 'password123',
    ...overrides,
  });
}

describe('ACC username: unique, permanent, protected', () => {
  it('is returned as the account identifier at registration', async () => {
    const res = await register(new Client());
    expect(res.status).toBe(201);
    expect(res.body.username).toBeTruthy();
    // No intake ID is issued any more.
    expect(res.body.intakeId).toBeUndefined();
  });

  it('rejects a duplicate username', async () => {
    const c = new Client();
    const res = await register(c, { username: SEED_USERNAME.collector });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate regardless of the case typed', async () => {
    // Normalization is what makes the unique index an index over what people
    // can type: "RED" and "red" are the same account, not two.
    const res = await register(new Client(), { username: SEED_USERNAME.collector.toUpperCase() });
    expect(res.status).toBe(400);
  });

  it('normalizes the username it stores', async () => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const res = await register(new Client(), { username: `  MiXeD${stamp}  ` });
    expect(res.status).toBe(201);
    expect(res.body.username).toBe(`mixed${stamp}`);
  });

  it('rejects a username outside the documented alphabet or length', async () => {
    for (const username of ['ab', 'has space', 'mail@host', 'a'.repeat(33)]) {
      const res = await register(new Client(), { username });
      expect(res.status, `expected 400 for ${JSON.stringify(username)}`).toBe(400);
    }
  });

  it('offers no way to change a username, on any surface', async () => {
    const collector = await signIn(SEED.collector);

    // The profile patch whitelists the name parts only, and the global
    // ValidationPipe runs with forbidNonWhitelisted.
    const own = await collector.patch('/me/profile', {
      firstName: 'Red',
      lastName: 'Ashwood',
      username: 'someone-else',
    });
    expect(own.status).toBe(400);

    // Nor can an administrator reassign one.
    const admin = await signIn(SEED.admin);
    const users = (await admin.get('/admin/users')).body as { id: string; username: string }[];
    const target = users.find((u) => u.username === SEED_USERNAME.collector)!;
    const patched = await admin.patch(`/admin/users/${target.id}`, { username: 'reassigned' });
    expect(patched.status).toBe(400);

    // And the username is unchanged after both attempts.
    expect(await usernameOf(SEED.collector)).toBe(SEED_USERNAME.collector);
  });
});

describe('ACC name: first and last, never a display name', () => {
  it('requires both name parts at registration', async () => {
    expect((await register(new Client(), { firstName: undefined })).status).toBe(400);
    expect((await register(new Client(), { lastName: undefined })).status).toBe(400);
    expect((await register(new Client(), { firstName: '' })).status).toBe(400);
  });

  it('rejects a name carrying markup or a control character', async () => {
    expect((await register(new Client(), { firstName: '<script>' })).status).toBe(400);
    expect((await register(new Client(), { lastName: 'a'.repeat(81) })).status).toBe(400);
  });

  it('returns the two parts and a derived full name, and no display name', async () => {
    const collector = await signIn(SEED.collector);
    const me = (await collector.get('/me/profile')).body as Record<string, unknown>;

    expect(me.firstName).toBeTruthy();
    expect(me.lastName).toBeTruthy();
    expect(me.fullName).toBe(`${me.firstName} ${me.lastName}`);
    expect(Object.keys(me)).not.toContain('displayName');
  });

  it('updates both parts together and re-derives the full name', async () => {
    const collector = await signIn(SEED.collector2);
    const updated = await collector.patch('/me/profile', { firstName: 'Golden', lastName: 'Marsh' });
    expect(updated.status).toBe(200);
    expect(updated.body.fullName).toBe('Golden Marsh');

    // Normalized on the way in: extra whitespace does not survive.
    const messy = await collector.patch('/me/profile', { firstName: '  Golden  ', lastName: ' Marsh ' });
    expect(messy.body.firstName).toBe('Golden');
    expect(messy.body.lastName).toBe('Marsh');
  });

  it('refuses a display-name field outright', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.patch('/me/profile', { displayName: 'Red' });
    expect(res.status).toBe(400);
  });

  it('validates a name on the administrative surface too', async () => {
    const admin = await signIn(SEED.admin);
    const users = (await admin.get('/admin/users')).body as { id: string; username: string }[];
    const target = users.find((u) => u.username === SEED_USERNAME.collector2)!;
    const res = await admin.patch(`/admin/users/${target.id}`, { firstName: '<b>' });
    expect(res.status).toBe(400);
  });
});

describe('ACC migrated accounts', () => {
  it('keeps a flagged legacy account signed in and usable', async () => {
    // The seeded `veteran` reproduces what migration 0004 leaves behind when a
    // single display name cannot be split without guessing: the whole string is
    // the first name, there is no last name, and the row is flagged.
    const client = await signIn(SEED.collector3);
    const me = (await client.get('/me/profile')).body as Record<string, unknown>;

    expect(me.username).toBe(SEED_USERNAME.collector3);
    expect(me.firstName).toBe('Ana Maria van der Berg');
    expect(me.lastName).toBeNull();
    expect(me.nameReviewRequired).toBe(true);
    // Nothing was invented: the full name is the first name, not a guess.
    expect(me.fullName).toBe('Ana Maria van der Berg');
  });

  it('surfaces the review flag to administrators', async () => {
    const admin = await signIn(SEED.admin);
    const users = (await admin.get('/admin/users')).body as Record<string, unknown>[];
    const veteran = users.find((u) => u.username === SEED_USERNAME.collector3)!;
    expect(veteran).toBeTruthy();
    expect(Object.keys(veteran)).toContain('nameReviewRequired');
  });

  /**
   * CONSUMES the flagged fixture: confirming the name is what clears the flag,
   * and there is no endpoint that sets it again (only the migration does). It is
   * ordered last in this block for that reason, and the suite is documented as
   * running against a freshly seeded database — see `helpers/http.ts`.
   */
  it('clears the review flag when the owner confirms a real split', async () => {
    const client = await signIn(SEED.collector3);
    const before = (await client.get('/me/profile')).body as { nameReviewRequired: boolean };
    expect(before.nameReviewRequired).toBe(true);

    const updated = await client.patch('/me/profile', { firstName: 'Ana Maria', lastName: 'van der Berg' });
    expect(updated.status).toBe(200);
    expect(updated.body.nameReviewRequired).toBe(false);
    // The split the OWNER supplied, not one the system guessed.
    expect(updated.body.firstName).toBe('Ana Maria');
    expect(updated.body.lastName).toBe('van der Berg');
    expect(updated.body.fullName).toBe('Ana Maria van der Berg');
  });
});

describe('ACC intake ID is retired from user-facing workflows', () => {
  it('is absent from the customer profile', async () => {
    const collector = await signIn(SEED.collector);
    const me = (await collector.get('/me/profile')).body as Record<string, unknown>;
    expect(Object.keys(me)).not.toContain('intakeId');
  });

  it('is not issued to a new account', async () => {
    const c = new Client();
    const res = await register(c);
    expect(res.body.intakeId).toBeUndefined();
  });

  it('remains visible to an administrator for troubleshooting', async () => {
    const admin = await signIn(SEED.admin);
    const users = (await admin.get('/admin/users')).body as Record<string, unknown>[];
    // The key exists on the admin surface; most accounts now have null there,
    // and the seeded legacy account still carries its historical OW- code.
    expect(Object.keys(users[0]!)).toContain('intakeId');
    const veteran = users.find((u) => u.username === SEED_USERNAME.collector3)!;
    expect(String(veteran.intakeId)).toMatch(/^OW-/);
  });

  it('routes an intake by username', async () => {
    const operator = await signIn(SEED.operator);
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const res = await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      binId: bins[0]!.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.ownerId).toBeTruthy();
  });

  it('normalizes the username an operator types', async () => {
    const operator = await signIn(SEED.operator);
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const res = await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector.toUpperCase(),
      typeClass: 'trading_card',
      binId: bins[0]!.id,
    });
    expect(res.status).toBe(201);
  });

  it('still accepts a legacy intake ID so a pre-printed label can be received', async () => {
    const admin = await signIn(SEED.admin);
    const users = (await admin.get('/admin/users')).body as Record<string, unknown>[];
    const veteran = users.find((u) => u.username === SEED_USERNAME.collector3)!;

    const operator = await signIn(SEED.operator);
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const res = await operator.post('/intake/items', {
      ownerIntakeId: veteran.intakeId,
      typeClass: 'trading_card',
      binId: bins[0]!.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.ownerId).toBe(veteran.id);
  });

  it('refuses an intake that names no owner at all', async () => {
    const operator = await signIn(SEED.operator);
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const res = await operator.post('/intake/items', {
      typeClass: 'trading_card',
      binId: bins[0]!.id,
    });
    expect(res.status).toBe(400);
  });

  it('reports an unknown username clearly', async () => {
    const operator = await signIn(SEED.operator);
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const res = await operator.post('/intake/items', {
      ownerUsername: 'nobody-by-that-name',
      typeClass: 'trading_card',
      binId: bins[0]!.id,
    });
    expect(res.status).toBe(404);
  });
});
