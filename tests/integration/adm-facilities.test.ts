import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Client, SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';

/**
 * The places parcels are sent to and shipped from are kept by an administrator. These tests make their own
 * facilities (codes beginning ZT) and take them away again, and leave the seed's two as they found them.
 */

interface Facility {
  id: string;
  code: string;
  name: string;
  role: 'primary' | 'forwarding';
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string | null;
  salesTaxBps: number;
  forwardsToFacilityId: string | null;
  forwardsToCode: string | null;
  forwardingDays: number | null;
  active: boolean;
  placeholder: boolean;
}

const ADDRESS = {
  line1: '500 Harbor Way',
  city: 'Elizabeth',
  region: 'NJ',
  postalCode: '07201',
  country: 'US',
};

const primary = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  name: `Test hub ${code}`,
  role: 'primary',
  ...ADDRESS,
  ...extra,
});

let admin: Client;

async function restore() {
  await sql(`DELETE FROM facility WHERE code LIKE 'ZT%'`);
  await sql(`UPDATE facility SET active = true WHERE code IN ('NJ', 'DE')`);
}

beforeAll(async () => {
  admin = await signIn(SEED.admin);
  await restore();
});

afterAll(async () => {
  await restore();
  await closeDb();
});

const list = async () => (await admin.get('/admin/facilities')).body as Facility[];
const byCode = async (code: string) => (await list()).find((f) => f.code === code);

describe('who may keep the facilities', () => {
  it('is the administrator and nobody else', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);
    const stranger = new Client();

    for (const who of [operator, collector]) {
      expect((await who.get('/admin/facilities')).status).toBe(403);
      expect((await who.post('/admin/facilities', primary('ZT0'))).status).toBe(403);
      expect((await who.patch('/admin/facilities/anything', { name: 'No' })).status).toBe(403);
    }
    expect((await stranger.get('/admin/facilities')).status).toBe(401);
    expect(await byCode('ZT0')).toBeUndefined();
  });
});

describe('the facilities as the administrator reads them', () => {
  it('lists the seed’s two, still on the placeholder address, with where Delaware forwards to', async () => {
    const all = await list();
    const nj = all.find((f) => f.code === 'NJ');
    const de = all.find((f) => f.code === 'DE');

    expect(nj).toMatchObject({
      role: 'primary',
      placeholder: true,
      active: true,
      salesTaxBps: 663,
      forwardsToCode: null,
    });
    expect(de).toMatchObject({
      role: 'forwarding',
      placeholder: true,
      forwardsToCode: 'NJ',
      forwardingDays: 4,
    });
    expect(de!.forwardsToFacilityId).toBe(nj!.id);
  });
});

describe('adding a facility', () => {
  it('writes it down, gives the customers its address, and lists it on the public page', async () => {
    const res = await admin.post(
      '/admin/facilities',
      primary('zt1', { line2: 'Dock 4', phone: '+1 908 555 0100', salesTaxBps: 663 }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: 'ZT1',
      name: 'Test hub zt1',
      role: 'primary',
      line1: '500 Harbor Way',
      line2: 'Dock 4',
      city: 'Elizabeth',
      region: 'NJ',
      postalCode: '07201',
      country: 'US',
      phone: '+1 908 555 0100',
      salesTaxBps: 663,
      forwardsToFacilityId: null,
      active: true,
      placeholder: false,
    });

    const collector = await signIn(SEED.collector);
    const addresses = (await collector.get('/me/inbound-addresses')).body as {
      code: string;
      careOf: string;
      lines: string[];
      city: string;
      postalCode: string;
    }[];
    expect(addresses.find((a) => a.code === 'ZT1')).toMatchObject({
      careOf: 'Bault C/O red',
      lines: ['500 Harbor Way', 'Dock 4'],
      city: 'Elizabeth',
      postalCode: '07201',
    });

    const locations = (await new Client().get('/content/locations')).body as {
      code: string;
      city: string;
    }[];
    expect(locations.find((l) => l.code === 'ZT1')).toMatchObject({ city: 'Elizabeth' });
  });

  it('takes a forwarding facility only with a primary one to hand its parcels to, and says for how long', async () => {
    const hub = await byCode('ZT1');

    const ok = await admin.post('/admin/facilities', {
      code: 'ZT2',
      name: 'Test relay',
      role: 'forwarding',
      line1: '9 Relay Rd',
      city: 'Wilmington',
      region: 'DE',
      postalCode: '19801',
      country: 'US',
      forwardsToFacilityId: hub!.id,
      forwardingDays: 3,
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ role: 'forwarding', forwardsToCode: 'ZT1', forwardingDays: 3 });

    const noTarget = await admin.post('/admin/facilities', {
      ...primary('ZT3'),
      role: 'forwarding',
      forwardingDays: 3,
    });
    const noDays = await admin.post('/admin/facilities', {
      ...primary('ZT3'),
      role: 'forwarding',
      forwardsToFacilityId: hub!.id,
    });
    const toRelay = await admin.post('/admin/facilities', {
      ...primary('ZT3'),
      role: 'forwarding',
      forwardsToFacilityId: ok.body.id,
      forwardingDays: 2,
    });
    const toNothing = await admin.post('/admin/facilities', {
      ...primary('ZT3'),
      role: 'forwarding',
      forwardsToFacilityId: 'not-a-facility',
      forwardingDays: 2,
    });
    for (const res of [noTarget, noDays, toRelay, toNothing]) expect(res.status).toBe(400);
    expect(toRelay.body.error.message).toMatch(/primary one/);
    expect(await byCode('ZT3')).toBeUndefined();
  });

  it('refuses a code that is taken, in whatever case it is written', async () => {
    const again = await admin.post('/admin/facilities', primary('zt1'));

    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/ZT1 already exists/);
    expect((await list()).filter((f) => f.code === 'ZT1')).toHaveLength(1);
  });

  it('refuses an address that is not one', async () => {
    const attempts: Record<string, unknown>[] = [
      primary('Z'),
      primary('ZT 4'),
      primary('ZT4', { line1: '   ' }),
      primary('ZT4', { name: '' }),
      primary('ZT4', { city: undefined }),
      primary('ZT4', { postalCode: '' }),
      primary('ZT4', { country: 'Atlantis' }),
      primary('ZT4', { region: '' }),
      primary('ZT4', { role: 'warehouse' }),
      primary('ZT4', { salesTaxBps: 9000 }),
      primary('ZT4', { salesTaxBps: 6.5 }),
      primary('ZT4', { unexpected: true }),
    ];
    for (const body of attempts) {
      const res = await admin.post('/admin/facilities', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await byCode('ZT4')).toBeUndefined();
    expect(await byCode('Z')).toBeUndefined();
  });

  it('takes a country named by its two letters, in any case, and no state where the country has none', async () => {
    const res = await admin.post('/admin/facilities', {
      code: 'ZT5',
      name: 'Test north',
      role: 'primary',
      line1: '1 Queen St',
      city: 'London',
      postalCode: 'EC1A 1BB',
      country: 'gb',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ country: 'GB', region: '' });
  });
});

describe('changing a facility', () => {
  it('replaces the placeholder with a real address, and from then on it is not a placeholder', async () => {
    const before = await byCode('ZT1');
    expect(before!.placeholder).toBe(false);

    await sql(`UPDATE facility SET line1 = 'SET REAL ADDRESS — placeholder' WHERE code = 'ZT1'`);
    expect((await byCode('ZT1'))!.placeholder).toBe(true);

    const res = await admin.patch(`/admin/facilities/${before!.id}`, {
      line1: '77 Real Street',
      line2: null,
      city: 'Newark',
      postalCode: '07102',
      phone: null,
      name: 'Bault Test Hub',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      code: 'ZT1',
      name: 'Bault Test Hub',
      line1: '77 Real Street',
      line2: null,
      city: 'Newark',
      postalCode: '07102',
      phone: null,
      placeholder: false,
    });
  });

  it('does not let the code or the role be changed, nor anything that is not a field', async () => {
    const hub = (await byCode('ZT1'))!;

    for (const body of [
      { code: 'NEW' },
      { role: 'forwarding' },
      { id: 'x' },
      { forwardsTo: 'x' },
    ]) {
      expect(
        (await admin.patch(`/admin/facilities/${hub.id}`, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect(await byCode('ZT1')).toMatchObject({ code: 'ZT1', role: 'primary' });
    expect((await admin.patch('/admin/facilities/not-a-facility', { name: 'Nobody' })).status).toBe(
      404,
    );
  });

  it('keeps the state a country needs, and the tax rate within what a rate can be', async () => {
    const hub = (await byCode('ZT1'))!;

    expect((await admin.patch(`/admin/facilities/${hub.id}`, { region: '' })).status).toBe(400);
    expect((await admin.patch(`/admin/facilities/${hub.id}`, { country: 'Atlantis' })).status).toBe(
      400,
    );
    expect((await admin.patch(`/admin/facilities/${hub.id}`, { salesTaxBps: 2501 })).status).toBe(
      400,
    );

    const ok = await admin.patch(`/admin/facilities/${hub.id}`, { salesTaxBps: 0 });
    expect(ok.status).toBe(200);
    expect(ok.body.salesTaxBps).toBe(0);
  });

  it('moves a forwarding facility to another primary one, and the days it holds a parcel', async () => {
    const [hub, relay] = [(await byCode('ZT1'))!, (await byCode('ZT2'))!];
    const second = await admin.post('/admin/facilities', primary('ZT6'));
    expect(second.status).toBe(201);

    const moved = await admin.patch(`/admin/facilities/${relay.id}`, {
      forwardsToFacilityId: second.body.id,
      forwardingDays: 5,
    });
    expect(moved.body).toMatchObject({ forwardsToCode: 'ZT6', forwardingDays: 5 });

    const back = await admin.patch(`/admin/facilities/${relay.id}`, {
      forwardsToFacilityId: hub.id,
    });
    expect(back.body).toMatchObject({ forwardsToCode: 'ZT1', forwardingDays: 5 });

    expect(
      (await admin.patch(`/admin/facilities/${relay.id}`, { forwardsToFacilityId: relay.id }))
        .status,
    ).toBe(400);
    expect(
      (await admin.patch(`/admin/facilities/${relay.id}`, { forwardsToFacilityId: null })).status,
    ).toBe(400);
    expect(
      (await admin.patch(`/admin/facilities/${hub.id}`, { forwardingDays: 9 })).body.forwardingDays,
    ).toBeNull();
  });
});

describe('taking a facility out of use', () => {
  it('keeps it in the list but not in the customers’ addresses, and brings it back', async () => {
    const spare = (await byCode('ZT6'))!;
    const collector = await signIn(SEED.collector);
    const offered = async () =>
      ((await collector.get('/me/inbound-addresses')).body as { code: string }[]).map(
        (a) => a.code,
      );

    expect(await offered()).toContain('ZT6');

    const off = await admin.patch(`/admin/facilities/${spare.id}`, { active: false });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    expect(await offered()).not.toContain('ZT6');
    expect(await byCode('ZT6')).toMatchObject({ active: false });
    const locations = (await new Client().get('/content/locations')).body as { code: string }[];
    expect(locations.map((l) => l.code)).not.toContain('ZT6');

    expect((await admin.patch(`/admin/facilities/${spare.id}`, { active: true })).body.active).toBe(
      true,
    );
    expect(await offered()).toContain('ZT6');
  });

  it('will not switch off a primary facility that another still forwards to', async () => {
    const hub = (await byCode('ZT1'))!;

    const res = await admin.patch(`/admin/facilities/${hub.id}`, { active: false });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Test relay still forwards to Bault Test Hub/);
    expect((await byCode('ZT1'))!.active).toBe(true);
  });

  it('will not switch on a forwarding facility whose primary one is off', async () => {
    const [hub, relay] = [(await byCode('ZT1'))!, (await byCode('ZT2'))!];

    expect((await admin.patch(`/admin/facilities/${relay.id}`, { active: false })).status).toBe(
      200,
    );
    expect((await admin.patch(`/admin/facilities/${hub.id}`, { active: false })).status).toBe(200);

    const res = await admin.patch(`/admin/facilities/${relay.id}`, { active: true });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/not active/);

    const added = await admin.post('/admin/facilities', {
      code: 'ZT7',
      name: 'Test late relay',
      role: 'forwarding',
      line1: '1 Late Ln',
      city: 'Dover',
      region: 'DE',
      postalCode: '19901',
      country: 'US',
      forwardsToFacilityId: hub.id,
      forwardingDays: 2,
    });
    expect(added.status).toBe(409);
  });

  it('will not switch off the only primary facility there is', async () => {
    const [nj, de] = [(await byCode('NJ'))!, (await byCode('DE'))!];
    for (const code of ['ZT1', 'ZT5', 'ZT6']) {
      const f = (await byCode(code))!;
      if (f.active)
        expect((await admin.patch(`/admin/facilities/${f.id}`, { active: false })).status).toBe(
          200,
        );
    }
    expect((await admin.patch(`/admin/facilities/${de.id}`, { active: false })).status).toBe(200);

    const res = await admin.patch(`/admin/facilities/${nj.id}`, { active: false });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/only active primary facility/);
    expect((await byCode('NJ'))!.active).toBe(true);
    expect((await admin.patch(`/admin/facilities/${de.id}`, { active: true })).status).toBe(200);
  });
});
