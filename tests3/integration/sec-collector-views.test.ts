import { afterAll, describe, it, expect } from 'vitest';
import { Client, SEED, signIn, intakeFor } from '../../tests/integration/helpers/http';
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
