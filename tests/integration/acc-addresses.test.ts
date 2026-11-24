import { describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';

describe('ACC saved shipping addresses', () => {
  it('adds, edits and removes an address, keeping one default', async () => {
    const c = await signIn(SEED.collector);

    const created = await c.post('/me/addresses', {
      label: 'Office',
      recipient: 'Red',
      line1: '500 Howard St',
      city: 'San Francisco',
      region: 'CA',
      country: 'US',
      postalCode: '94105',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const edited = await c.patch(`/me/addresses/${id}`, {
      line1: '501 Howard St',
      isDefault: true,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.line1).toBe('501 Howard St');
    expect(edited.body.isDefault).toBe(true);

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

describe('ACC an address has to be one a carrier can read', () => {
  const GOOD = {
    label: 'Home',
    recipient: 'Red',
    line1: '500 Howard St',
    city: 'San Francisco',
    region: 'CA',
    country: 'US',
    postalCode: '94105',
  };

  it('refuses empty, overlong and marked-up fields, naming the field in words', async () => {
    const c = await signIn(SEED.collector);
    const cases: [Record<string, unknown>, string][] = [
      [{ label: '   ' }, 'The label is required.'],
      [{ recipient: '' }, 'The recipient is required.'],
      [{ line1: '' }, 'The street address is required.'],
      [{ city: '' }, 'The city is required.'],
      [{ postalCode: '' }, 'The postal code is required.'],
      [{ recipient: 'x'.repeat(121) }, 'The recipient can be at most 120 characters.'],
      [{ line1: '<script>alert(1)</script>' }, 'The street address cannot contain < or > or control characters.'],
      [{ city: 'San\u0007Francisco' }, 'The city cannot contain < or > or control characters.'],
      [{ line2: '<b>' }, 'The apartment, suite or unit line cannot contain < or > or control characters.'],
    ];
    for (const [change, message] of cases) {
      const res = await c.post('/me/addresses', { ...GOOD, ...change });
      expect(res.status, JSON.stringify(change)).toBe(400);
      expect(res.body.error.message, JSON.stringify(change)).toBe(message);
    }
  });

  it('saves the fields trimmed, and refuses an edit that empties one', async () => {
    const c = await signIn(SEED.collector);
    const created = await c.post('/me/addresses', { ...GOOD, label: '  Studio  ', city: ' San Francisco ' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ label: 'Studio', city: 'San Francisco' });
    const id = created.body.id as string;
    try {
      const emptied = await c.patch(`/me/addresses/${id}`, { recipient: ' ' });
      expect(emptied.status).toBe(400);
      expect(emptied.body.error.message).toBe('The recipient is required.');
      expect((await c.patch(`/me/addresses/${id.toUpperCase()}`, { label: 'Loft' })).body.label).toBe('Loft');
    } finally {
      await c.del(`/me/addresses/${id}`);
    }
  });
});

describe('ACC an address names its state or province where carriers need one', () => {
  const OFFICE = {
    label: 'Office',
    recipient: 'Red',
    line1: '500 Howard St',
    city: 'San Francisco',
    country: 'US',
    postalCode: '94105',
  };
  const TORONTO = { ...OFFICE, label: 'Toronto', city: 'Toronto', country: 'CA', postalCode: 'M5H 2N2' };
  const AMSTERDAM = {
    label: 'Amsterdam',
    recipient: 'Red',
    line1: 'Keizersgracht 12',
    city: 'Amsterdam',
    country: 'NL',
    postalCode: '1015 CS',
  };

  it('refuses a US address without its state and a Canadian one without its province', async () => {
    const c = await signIn(SEED.collector);

    const us = await c.post('/me/addresses', OFFICE);
    expect(us.status).toBe(400);
    expect(us.body.error.message).toMatch(/state/i);

    const ca = await c.post('/me/addresses', TORONTO);
    expect(ca.status).toBe(400);
    expect(ca.body.error.message).toMatch(/province/i);
  });

  it('takes the two-letter code in any case, stores it upper case, and refuses one that is not on the list', async () => {
    const c = await signIn(SEED.collector);

    const ok = await c.post('/me/addresses', { ...OFFICE, region: ' ca ' });
    expect(ok.status).toBe(201);
    expect(ok.body.region).toBe('CA');

    expect((await c.post('/me/addresses', { ...OFFICE, region: 'XX' })).status).toBe(400);
    expect((await c.post('/me/addresses', { ...TORONTO, region: 'NY' })).status).toBe(400);

    const on = await c.post('/me/addresses', { ...TORONTO, region: 'on' });
    expect(on.status).toBe(201);
    expect(on.body.region).toBe('ON');

    await c.del(`/me/addresses/${ok.body.id}`);
    await c.del(`/me/addresses/${on.body.id}`);
  });

  it('leaves it optional elsewhere, as free text with a length cap', async () => {
    const c = await signIn(SEED.collector);

    const without = await c.post('/me/addresses', AMSTERDAM);
    expect(without.status).toBe(201);
    expect(without.body.region).toBeNull();

    const named = await c.post('/me/addresses', { ...AMSTERDAM, region: '  Noord-Holland ' });
    expect(named.status).toBe(201);
    expect(named.body.region).toBe('Noord-Holland');

    expect((await c.post('/me/addresses', { ...AMSTERDAM, region: 'x'.repeat(61) })).status).toBe(400);

    await c.del(`/me/addresses/${without.body.id}`);
    await c.del(`/me/addresses/${named.body.id}`);
  });

  it('checks the country and the state again when an edit changes either', async () => {
    const c = await signIn(SEED.collector);
    const id = (await c.post('/me/addresses', AMSTERDAM)).body.id as string;

    expect((await c.patch(`/me/addresses/${id}`, { country: 'US', postalCode: '94105' })).status).toBe(400);

    const moved = await c.patch(`/me/addresses/${id}`, { country: 'US', postalCode: '94105', region: 'ny' });
    expect(moved.status).toBe(200);
    expect(moved.body.region).toBe('NY');

    expect((await c.patch(`/me/addresses/${id}`, { region: '' })).status).toBe(400);
    expect((await c.patch(`/me/addresses/${id}`, { label: 'Still here' })).status).toBe(200);

    await c.del(`/me/addresses/${id}`);
  });

  it('publishes which countries need one, with the codes to choose from', async () => {
    const c = await signIn(SEED.collector);
    const countries = (await c.get('/shipping/countries')).body as {
      code: string;
      regionRequired: boolean;
      regions?: { code: string; name: string }[];
    }[];
    const byCode = new Map(countries.map((row) => [row.code, row]));

    expect(byCode.get('US')?.regionRequired).toBe(true);
    expect(byCode.get('US')?.regions).toContainEqual({ code: 'NY', name: 'New York' });
    expect(byCode.get('CA')?.regionRequired).toBe(true);
    expect(byCode.get('CA')?.regions).toContainEqual({ code: 'ON', name: 'Ontario' });
    expect(byCode.get('NL')?.regionRequired).toBe(false);
    expect(byCode.get('NL')?.regions).toBeUndefined();
  });
});

describe('ACC an address carries an apartment line and a phone for the carrier', () => {
  const FLAT = {
    label: 'Flat',
    recipient: 'Red',
    line1: '500 Howard St',
    line2: ' Apt 4B ',
    city: 'San Francisco',
    region: 'CA',
    country: 'US',
    postalCode: '94105',
    phone: ' +1 415-555-0134 ',
  };

  it('saves both, trimmed, and reads them back with the address', async () => {
    const c = await signIn(SEED.collector);
    const created = await c.post('/me/addresses', FLAT);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ line2: 'Apt 4B', phone: '+1 415-555-0134' });
    expect(created.body).not.toHaveProperty('userId');
    expect(created.body).not.toHaveProperty('createdAt');

    const listed = ((await c.get('/me/addresses')).body as { id: string; line2: string; phone: string }[]).find(
      (a) => a.id === created.body.id,
    );
    expect(listed).toMatchObject({ line2: 'Apt 4B', phone: '+1 415-555-0134' });

    const edited = await c.patch(`/me/addresses/${created.body.id}`, { line2: 'Suite 9', phone: '020 7946 0958' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ line2: 'Suite 9', phone: '020 7946 0958' });

    const cleared = await c.patch(`/me/addresses/${created.body.id}`, { line2: '', phone: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ line2: null, phone: null });

    await c.del(`/me/addresses/${created.body.id}`);
  });

  it('leaves both optional, and refuses a long apartment line or a phone that is not one', async () => {
    const c = await signIn(SEED.collector);
    const { line2: _line2, phone: _phone, ...plain } = FLAT;
    const without = await c.post('/me/addresses', plain);
    expect(without.status).toBe(201);
    expect(without.body).toMatchObject({ line2: null, phone: null });
    await c.del(`/me/addresses/${without.body.id}`);

    const long = await c.post('/me/addresses', { ...FLAT, line2: 'x'.repeat(101) });
    expect(long.status).toBe(400);
    expect(long.body.error.message).toMatch(/apartment|line/i);
    for (const phone of ['12345', '1'.repeat(21), 'call me', '(415) 555-0134', '+++ ---']) {
      const bad = await c.post('/me/addresses', { ...FLAT, phone });
      expect(bad.status, phone).toBe(400);
      expect(bad.body.error.message).toMatch(/phone/i);
    }
  });
});
