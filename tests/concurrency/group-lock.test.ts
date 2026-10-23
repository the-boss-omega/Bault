import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from '../integration/helpers/http';
import { closeDb, holdRowLock, sql, waitForLockWaiters } from '../integration/helpers/db';

type Res = Awaited<ReturnType<Client['post']>>;

afterAll(closeDb);

const SHARED = {
  label: 'Convention hotel',
  recipient: 'Front desk — Bault group',
  line1: '400 Boardwalk',
  city: 'Atlantic City',
  region: 'NJ',
  country: 'US',
  postalCode: '08401',
};

async function formingGroup(label: string) {
  const operator = await signIn(SEED.operator);
  const red = await signIn(SEED.collector);
  const golden = await signIn(SEED.collector2);
  await fundWallet(SEED.collector, 5_000);
  await fundWallet(SEED.collector2, 5_000);
  const mine = await intakeFor(operator, SEED.collector, { description: `${label}: Red's` });
  const theirs = await intakeFor(operator, SEED.collector2, { description: `${label}: Golden's` });
  const redAddr = (await red.post('/me/addresses', SHARED)).body.id as string;
  const goldenAddr = (await golden.post('/me/addresses', SHARED)).body.id as string;
  const redShip = await red.post('/shipping/shipments', { itemIds: [mine.id], addressId: redAddr });
  expect(redShip.status, JSON.stringify(redShip.body)).toBe(201);
  const goldenShip = (await golden.post('/shipping/shipments', { itemIds: [theirs.id], addressId: goldenAddr })).body;
  const opened = await red.post('/shipping/groups', { shipmentId: redShip.body.id, notes: label });
  expect(opened.status, JSON.stringify(opened.body)).toBe(201);
  const group = opened.body;
  const joined = await golden.post('/shipping/groups/join', { groupCode: group.code, shipmentId: goldenShip.id });
  expect(joined.status, JSON.stringify(joined.body)).toBe(201);
  return { red, groupId: group.id as string, code: group.code as string };
}

const lockedEvents = async (code: string) =>
  (
    await sql<{ n: number }>(
      `select count(*)::int as n from outbox_message where event_type = 'group_shipment_locked' and payload ->> 'groupCode' = $1`,
      [code],
    )
  )[0]!.n;

describe('concurrency: locking a shared parcel', () => {
  it('two locks queued on one group: one locks it, and every member is told once', { timeout: 30_000 }, async () => {
    const { red, groupId, code } = await formingGroup('Two locks');

    const held = await holdRowLock('shipment_group', groupId);
    let locks: Promise<Res>[] = [];
    try {
      locks = [red.post(`/shipping/groups/${groupId}/lock`), red.post(`/shipping/groups/${groupId}/lock`)];
      await waitForLockWaiters(2);
    } finally {
      await held.release();
    }
    const res = await Promise.all(locks);

    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await lockedEvents(code)).toBe(2);
  });

  it('a lock queued behind a cancellation is refused, and nobody is told it was locked', { timeout: 30_000 }, async () => {
    const { red, groupId, code } = await formingGroup('Lock after cancel');

    const held = await holdRowLock('shipment_group', groupId);
    let cancel: Promise<Res> | undefined;
    let lock: Promise<Res> | undefined;
    try {
      cancel = red.post(`/shipping/groups/${groupId}/cancel`, { reason: 'Hotel changed.' });
      await waitForLockWaiters(1);
      lock = red.post(`/shipping/groups/${groupId}/lock`);
      await waitForLockWaiters(2);
    } finally {
      await held.release();
    }
    const [cancelled, locked] = await Promise.all([cancel!, lock!]);

    expect(cancelled.status).toBe(201);
    expect(locked.status).toBe(409);
    const [row] = await sql<{ status: string }>('select status from shipment_group where id = $1', [groupId]);
    expect(row!.status).toBe('cancelled');
    expect(await lockedEvents(code)).toBe(0);
  });

  it('a member joining as the group is locked is either told or refused, never added after', { timeout: 30_000 }, async () => {
    const { red, groupId, code } = await formingGroup('Join during lock');
    const operator = await signIn(SEED.operator);
    const veteran = await signIn(SEED.collector3);
    await fundWallet(SEED.collector3, 5_000);
    const card = await intakeFor(operator, SEED.collector3, { description: 'Join during lock: Veteran' });
    const addr = (await veteran.post('/me/addresses', SHARED)).body.id as string;
    const lateRes = await veteran.post('/shipping/shipments', { itemIds: [card.id], addressId: addr });
    expect(lateRes.status, JSON.stringify(lateRes.body)).toBe(201);
    const late = lateRes.body;

    const held = await holdRowLock('shipment', late.id);
    let join: Promise<Res> | undefined;
    let lock: Promise<Res> | undefined;
    try {
      join = veteran.post('/shipping/groups/join', { groupCode: code, shipmentId: late.id });
      await waitForLockWaiters(1);
      lock = red.post(`/shipping/groups/${groupId}/lock`);
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      await held.release();
    }
    const [joined, locked] = await Promise.all([join!, lock!]);
    expect(locked.status).toBe(201);

    const members = await sql<{ n: number }>('select count(*)::int as n from shipment where group_id = $1', [groupId]);
    expect({ members: members[0]!.n, told: await lockedEvents(code) }).toEqual(
      joined.status === 201 ? { members: 3, told: 3 } : { members: 2, told: 2 },
    );
  });
});
