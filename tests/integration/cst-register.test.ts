import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from './helpers/http';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface RegisterEntry {
  at: string;
  kind: string;
  params: Record<string, unknown>;
}

describe('CST the item register, as the card’s owner reads it', () => {
  it('names shelves by label, keeps amounts in minor units, and carries no ids or English sentences', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, {
      typeClass: 'trading_card',
      description: 'Register check',
      conditionGrade: 'PSA 8',
    });
    const itemId = item.id as string;
    const bins = (await operator.get('/custody/bins')).body as { id: string; barcode: string; zone: string }[];
    const origin = bins.find((b) => b.id === item.binId)!;
    const destination = bins.find((b) => b.id !== item.binId)!;
    const label = (b: { barcode: string; zone: string }) => ({ barcode: b.barcode, zone: b.zone });

    const corrected = await operator.patch(`/intake/items/${itemId}`, {
      patches: [{ field: 'conditionGrade', value: 'PSA 9' }],
    });
    expect(corrected.status).toBe(200);
    expect((await operator.post(`/custody/items/${itemId}/relocate`, { binId: destination.id })).status).toBe(201);

    const seller = await signIn(SEED.collector);
    const listing = (await seller.post('/marketplace/listings', { itemId, askingPrice: 26_000 })).body;
    await fundWallet(SEED.collector2, 30_000);
    const buyer = await signIn(SEED.collector2);
    expect((await buyer.post(`/marketplace/listings/${listing.id}/purchase`)).status).toBe(201);

    const res = await buyer.get(`/vault/items/${itemId}/timeline`);
    expect(res.status).toBe(200);
    const events = res.body as RegisterEntry[];

    for (const e of events) expect(Object.keys(e).sort()).toEqual(['at', 'kind', 'params']);
    const text = JSON.stringify(events);
    expect(text).not.toMatch(UUID);
    expect(text).not.toMatch(/cents|recorded|Moved|∅/);

    expect(events.find((e) => e.kind === 'intake')?.params).toEqual({
      fromBin: null,
      toBin: label(origin),
      fromState: null,
      toState: 'stored',
    });
    expect(events.find((e) => e.kind === 'relocate')?.params).toEqual({
      fromBin: label(origin),
      toBin: label(destination),
    });
    expect(events.filter((e) => e.kind === 'bin_transfer').map((e) => e.params)).toEqual(
      expect.arrayContaining([
        { fromBin: null, toBin: label(origin) },
        { fromBin: label(origin), toBin: label(destination) },
      ]),
    );
    expect(events.find((e) => e.kind === 'correction')?.params).toEqual({
      field: 'conditionGrade',
      from: 'PSA 8',
      to: 'PSA 9',
    });
    expect(events.find((e) => e.kind === 'state_change' && e.params.toState === 'listed')?.params).toEqual({
      fromState: 'stored',
      toState: 'listed',
    });
    expect(events.find((e) => e.kind === 'ownership_transfer')?.params).toEqual({});
    expect(events.find((e) => e.kind === 'sale')?.params).toEqual({ amountMinor: 26_000 });
  });

  it('gives the warehouse the same entries', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const res = await operator.get(`/custody/items/${item.id}/timeline`);
    expect(res.status).toBe(200);
    const events = res.body as RegisterEntry[];
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(Object.keys(e).sort()).toEqual(['at', 'kind', 'params']);
    expect(JSON.stringify(events)).not.toMatch(UUID);
  });
});
