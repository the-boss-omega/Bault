import { describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';

/**
 * ACC-07 / Requirement 4.2 — saved shipping addresses are added, EDITED and
 * removed from the Profile page, and they are what feeds the shipping dropdown
 * (Requirement 5.1). Requires a running API + seeded DB.
 */
describe('ACC saved shipping addresses', () => {
  it('adds, edits and removes an address, keeping one default', async () => {
    const c = await signIn(SEED.collector);

    const created = await c.post('/me/addresses', {
      label: 'Office',
      recipient: 'Red',
      line1: '500 Howard St',
      city: 'San Francisco',
      country: 'US',
      postalCode: '94105',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // EDIT — the piece that used to be missing entirely.
    const edited = await c.patch(`/me/addresses/${id}`, {
      line1: '501 Howard St',
      isDefault: true,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.line1).toBe('501 Howard St');
    expect(edited.body.isDefault).toBe(true);

    // Promoting a new default demotes the previous one — exactly one survives.
    const all = (await c.get('/me/addresses')).body as { id: string; isDefault: boolean }[];
    expect(all.filter((a) => a.isDefault)).toHaveLength(1);

    const removed = await c.del(`/me/addresses/${id}`);
    expect(removed.status).toBe(200);
    const after = (await c.get('/me/addresses')).body as { id: string }[];
    expect(after.some((a) => a.id === id)).toBe(false);
  });

  it('never exposes or edits another user’s address', async () => {
    const owner = await signIn(SEED.collector);
    const mine = (await owner.get('/me/addresses')).body as { id: string }[];
    expect(mine.length).toBeGreaterThan(0);
    const targetId = mine[0].id;

    const other = await signIn(SEED.collector2);
    const theirs = (await other.get('/me/addresses')).body as { id: string }[];
    expect(theirs.some((a) => a.id === targetId)).toBe(false);

    const attempt = await other.patch(`/me/addresses/${targetId}`, { city: 'Nowhere' });
    expect(attempt.status).toBe(404);
  });
});
