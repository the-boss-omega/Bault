import { afterAll, describe, it, expect } from 'vitest';
import { SEED, SEED_USERNAME, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

const tracking = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function chargesFor(parcelId: string) {
  return sql<{ action_type: string; user_id: string }>(
    `SELECT action_type, user_id::text AS user_id FROM charge WHERE reference_id = $1 ORDER BY action_type`,
    [parcelId],
  );
}

async function userIdOf(username: string): Promise<string> {
  const rows = await sql<{ id: string }>(`SELECT id::text AS id FROM user_account WHERE username = $1`, [username]);
  return rows[0]!.id;
}

describe('a parcel whose contents have been booked in', () => {
  it('cannot be disposed of, so the owner is not told it was destroyed and the fee is still charged', async () => {
    const operator = await signIn(SEED.operator);
    const received = await operator.post('/parcels/receive', {
      facilityCode: 'NJ',
      addressedTo: SEED_USERNAME.collector,
      trackingNumber: tracking('DISPOSE'),
    });
    const parcelId = received.body.id as string;
    expect((await operator.post(`/parcels/${parcelId}/open`, { condition: 'sound', conditionNotes: 'Fine.' })).status).toBe(201);
    const booked = await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      autoStow: true,
      parcelId,
    });
    expect(booked.status).toBe(201);

    const disposed = await operator.post(`/parcels/${parcelId}/dispose`, { reason: 'Mistake' });
    expect(disposed.status).toBe(409);
    expect(disposed.body.error.message).toBe('Items have been booked in from this parcel; finish processing it instead');

    const processed = await operator.post(`/parcels/${parcelId}/process`, {});
    expect(processed.status).toBe(201);
    expect((await chargesFor(parcelId)).map((c) => c.action_type)).toEqual(['parcel_processing']);
  });
});

describe('a refused parcel move', () => {
  it('says what the parcel is now in plain words', async () => {
    const operator = await signIn(SEED.operator);
    const received = await operator.post('/parcels/receive', {
      facilityCode: 'NJ',
      addressedTo: SEED_USERNAME.collector,
      trackingNumber: tracking('TWICE'),
    });
    const parcelId = received.body.id as string;
    await operator.post(`/parcels/${parcelId}/open`, { condition: 'sound', conditionNotes: 'Fine.' });
    expect((await operator.post(`/parcels/${parcelId}/process`, { emptyReason: 'Empty box' })).status).toBe(201);
    const again = await operator.post(`/parcels/${parcelId}/process`, { emptyReason: 'Empty box' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('This parcel has already been processed');
    expect(again.body.error.details).toMatchObject({ from: 'processed', to: 'processed' });
  });
});

describe('registering a tracking number that is already in use', () => {
  it('names the parcel code only to its own owner', async () => {
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const number = tracking('TAKEN');
    const mine = await red.post('/me/parcels', { facilityCode: 'NJ', trackingNumber: number });
    expect(mine.status).toBe(201);

    const theirs = await golden.post('/me/parcels', { facilityCode: 'NJ', trackingNumber: number });
    expect(theirs.status).toBe(409);
    expect(theirs.body.error.message).toBe('That tracking number is already registered. If it is yours, contact support.');
    expect(JSON.stringify(theirs.body)).not.toContain(mine.body.code as string);

    const again = await red.post('/me/parcels', { facilityCode: 'NJ', trackingNumber: number });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain(mine.body.code as string);
  });

  it('counts an unclaimed parcel already in the building as in use', async () => {
    const operator = await signIn(SEED.operator);
    const red = await signIn(SEED.collector);
    const number = tracking('HELD');
    const held = await operator.post('/parcels/receive', { facilityCode: 'NJ', addressedTo: 'nobody-at-all', trackingNumber: number });
    expect(held.body.status).toBe('unclaimed');
    expect((await red.post('/me/parcels', { facilityCode: 'NJ', trackingNumber: number })).status).toBe(409);
  });

  it('refuses an expected date it cannot read', async () => {
    const red = await signIn(SEED.collector);
    const res = await red.post('/me/parcels', { facilityCode: 'NJ', trackingNumber: tracking('DATE'), expectedAt: 'next tuesday' });
    expect(res.status).toBe(400);
  });
});

describe('a box whose label names someone other than the registrant', () => {
  it('is held unclaimed for a person to decide, and the registration is left alone', async () => {
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const operator = await signIn(SEED.operator);
    const number = tracking('MISMATCH');
    const registered = await red.post('/me/parcels', {
      facilityCode: 'NJ',
      trackingNumber: number,
      declaredContents: 'Red’s private list of cards',
    });
    expect(registered.status).toBe(201);

    const arrived = await operator.post('/parcels/receive', {
      facilityCode: 'NJ',
      addressedTo: SEED_USERNAME.collector2,
      trackingNumber: number,
    });
    expect(arrived.status).toBe(201);
    expect(arrived.body.id).not.toBe(registered.body.id);
    expect(arrived.body.status).toBe('unclaimed');
    expect(JSON.stringify(arrived.body)).not.toContain('private list');

    expect((await golden.get(`/parcels/${arrived.body.id}`)).status).toBe(404);
    expect((await golden.get(`/parcels/${registered.body.id}`)).status).toBe(404);
    const still = await red.get(`/parcels/${registered.body.id}`);
    expect(still.body.parcel.status).toBe('expected');
  });
});

describe('forwarding an unclaimed parcel', () => {
  it('bills the forwarding to whoever it is claimed for, once, and records only charges that were raised', async () => {
    const operator = await signIn(SEED.operator);
    const received = await operator.post('/parcels/receive', {
      facilityCode: 'DE',
      addressedTo: 'nobody-with-this-name',
      trackingNumber: tracking('FWD'),
    });
    expect(received.body.status).toBe('unclaimed');
    const parcelId = received.body.id as string;

    expect((await operator.post(`/parcels/${parcelId}/forward`, {})).status).toBe(201);
    expect(await chargesFor(parcelId)).toEqual([]);

    expect((await operator.post(`/parcels/${parcelId}/claim`, { ownerUsername: SEED_USERNAME.collector })).status).toBe(201);
    const red = await userIdOf(SEED_USERNAME.collector);
    expect(await chargesFor(parcelId)).toEqual([{ action_type: 'parcel_forwarding', user_id: red }]);

    await operator.post(`/parcels/${parcelId}/open`, { condition: 'sound', conditionNotes: 'Fine.' });
    expect((await operator.post(`/parcels/${parcelId}/process`, { emptyReason: 'Nothing inside' })).status).toBe(201);
    expect((await chargesFor(parcelId)).map((c) => c.action_type)).toEqual(['parcel_forwarding', 'parcel_processing']);
    const [row] = await sql<{ charges: Record<string, boolean> }>(`SELECT charges FROM parcel WHERE id = $1`, [parcelId]);
    expect(row!.charges).toEqual({ forwarding: true, processing: true });
  });

  it('does not mark forwarding as charged for a parcel that was never forwarded', async () => {
    const operator = await signIn(SEED.operator);
    const received = await operator.post('/parcels/receive', {
      facilityCode: 'NJ',
      addressedTo: SEED_USERNAME.collector,
      trackingNumber: tracking('DIRECT'),
    });
    const parcelId = received.body.id as string;
    await operator.post(`/parcels/${parcelId}/open`, { condition: 'sound', conditionNotes: 'Fine.' });
    await operator.post(`/parcels/${parcelId}/process`, { emptyReason: 'Nothing inside' });
    const [row] = await sql<{ charges: Record<string, boolean> }>(`SELECT charges FROM parcel WHERE id = $1`, [parcelId]);
    expect(row!.charges).toEqual({ processing: true });
  });
});
