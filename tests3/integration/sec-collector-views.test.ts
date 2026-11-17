import { afterAll, describe, it, expect } from 'vitest';
import { Client, SEED, fundWallet, signIn, intakeFor } from '../../tests/integration/helpers/http';
import { closeDb } from '../../tests/integration/helpers/db';

afterAll(closeDb);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keysIn(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysIn(v, out);
    }
  }
  return out;
}

function expectWithout(body: unknown, dropped: readonly string[]) {
  const present = keysIn(body);
  expect(dropped.filter((k) => present.has(k)), 'keys a collector must not receive').toEqual([]);
}

function expectWith(body: unknown, kept: readonly string[]) {
  const present = keysIn(body);
  expect(kept.filter((k) => !present.has(k)), 'keys a collector still needs').toEqual([]);
}

async function userIdOf(client: Client): Promise<string> {
  return (await client.get('/me/profile')).body.id as string;
}

describe('A1 the vault item card a collector reads', () => {
  it('carries the card, its pictures and only the custody events of the caller’s own holding', async () => {
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    const red = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector2, { description: 'Passed from Golden to Red' });
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const otherBin = bins.find((b) => b.id !== item.binId)!.id;

    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: true })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: false })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { description: 'Corrected title' })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { binId: otherBin })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { ownerId: await userIdOf(red) })).status).toBe(200);

    const res = await red.get(`/vault/items/${item.id}`);
    expect(res.status).toBe(200);
    expectWithout(res.body, [
      'ownerId',
      'binId',
      'barcode',
      'sourceBatchId',
      'sourceParcelId',
      'weightGrams',
      'updatedAt',
      'objectKey',
      'contentHash',
      'itemId',
      'actorId',
      'reason',
      'metadata',
      'prevOwnerId',
      'newOwnerId',
      'prevBinId',
      'newBinId',
    ]);
    expectWith(res.body.item, ['id', 'serialNumber', 'description', 'typeClass', 'lifecycleState', 'holdFlag', 'isLot']);
    const history = res.body.history as { eventType: string }[];
    expect(history.map((e) => e.eventType)).toEqual(['ownership_transfer']);
    expect(Object.keys(history[0]!).sort()).toEqual(['eventType', 'newState', 'occurredAt', 'prevState']);
    expect(res.body.openRequests).toEqual([]);

    const staff = await operator.get(`/custody/items/${item.id}/history`);
    expect(staff.status).toBe(200);
    expectWith(staff.body, ['actorId', 'reason', 'prevOwnerId', 'newOwnerId', 'prevBinId', 'newBinId']);
    expect((staff.body as unknown[]).length).toBeGreaterThan(history.length);
  });
});

describe('A2 the vault item timeline a collector reads', () => {
  it('covers only the caller’s holding and leaves out shelves, corrections and moves', async () => {
    const operator = await signIn(SEED.operator);
    const admin = await signIn(SEED.admin);
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const item = await intakeFor(operator, SEED.collector2, { description: 'Timeline across owners' });
    const bins = (await operator.get('/custody/bins')).body as { id: string }[];
    const otherBin = bins.find((b) => b.id !== item.binId)!.id;

    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: true })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: false })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { conditionGrade: 'PSA 7' })).status).toBe(200);
    expect((await operator.post(`/custody/items/${item.id}/relocate`, { binId: otherBin })).status).toBe(201);
    expect((await admin.patch(`/admin/items/${item.id}`, { ownerId: await userIdOf(red) })).status).toBe(200);
    expect((await admin.patch(`/admin/items/${item.id}`, { holdFlag: true })).status).toBe(200);

    const mine = await red.get(`/vault/items/${item.id}/timeline`);
    expect(mine.status).toBe(200);
    expectWithout(mine.body, ['fromBin', 'toBin', 'ruling', 'field']);
    const kinds = (mine.body as { kind: string }[]).map((e) => e.kind).sort();
    expect(kinds).toEqual(['hold_placed', 'ownership_transfer']);

    const before = await golden.get(`/vault/items/${item.id}/timeline`);
    expect(before.status).toBe(200);
    const theirs = (before.body as { kind: string }[]).map((e) => e.kind);
    expect(theirs).toContain('intake');
    expect(theirs).toContain('hold_released');
    expect(theirs).toContain('ownership_transfer');
    expect(theirs.filter((k) => ['correction', 'bin_transfer', 'relocate'].includes(k))).toEqual([]);
    expect(theirs.filter((k) => k === 'hold_placed')).toHaveLength(1);

    const staff = await operator.get(`/custody/items/${item.id}/timeline`);
    const staffKinds = (staff.body as { kind: string }[]).map((e) => e.kind);
    expect(staffKinds).toEqual(expect.arrayContaining(['correction', 'bin_transfer', 'relocate', 'intake']));
    expectWith(staff.body, ['toBin', 'field']);
  });
});

const REQUEST_DROPPED = [
  'requesterId',
  'batchId',
  'chargeId',
  'fulfilledBy',
  'fulfilledAt',
  'fulfillment',
  'quotedBy',
  'declinedBy',
  'completedBy',
  'approvalBy',
  'approvalReason',
  'rationale',
  'eventId',
  'transactionId',
  'deniedAt',
  'periodId',
  'allowance',
  'kind',
] as const;

describe('A3 service requests as a collector reads them', () => {
  it('lists and returns requests without staff or billing internals', async () => {
    await fundWallet(SEED.collector, 50_000);
    const operator = await signIn(SEED.operator);
    const red = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Service view card' });

    const photo = await red.post('/services/photography', { itemId: item.id });
    expect(photo.status).toBe(201);
    expectWithout(photo.body, REQUEST_DROPPED);
    expectWith(photo.body, ['id', 'code', 'type', 'status', 'itemId', 'createdAt', 'typeFields']);

    const asked = await red.post('/services/custom', {
      itemId: item.id,
      summary: 'Clean the case',
      detail: 'Please wipe the slab case and remove the sticker residue.',
    });
    expect(asked.status).toBe(201);
    expectWithout(asked.body, REQUEST_DROPPED);
    expect(asked.body.code).toBeTruthy();
    expect((await operator.post(`/services/requests/${asked.body.id}/accept`)).status).toBe(201);
    const quoted = await operator.post(`/services/custom/${asked.body.id}/quote`, {
      priceMinor: 12_00,
      scope: 'Wipe the case and lift the residue with a plastic blade.',
    });
    expect(quoted.status).toBe(201);
    expect(quoted.body.typeFields.quotedBy).toBeTruthy();

    const mine = await red.get('/services/mine');
    expect(mine.status).toBe(200);
    expectWithout(mine.body, REQUEST_DROPPED);
    const rows = mine.body as { id: string; typeFields: Record<string, unknown> }[];
    const custom = rows.find((r) => r.id === asked.body.id)!;
    expect(custom.typeFields).toMatchObject({ stage: 'quoted', priceMinor: 12_00, summary: 'Clean the case' });
    expect(custom.typeFields.scope).toMatch(/plastic blade/);
    const shoot = rows.find((r) => r.id === photo.body.id)!;
    if (shoot.typeFields.billed !== undefined) {
      expect(Object.keys(shoot.typeFields.billed as object).sort()).toEqual(['amountMinor', 'currency']);
    }

    const queue = await operator.get('/services/queue');
    const staffRow = (queue.body as { id: string; typeFields: Record<string, unknown> }[]).find(
      (r) => r.id === asked.body.id,
    )!;
    expect(staffRow.typeFields.quotedBy).toBeTruthy();
  });
});
