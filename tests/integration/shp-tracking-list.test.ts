import { describe, it, expect } from 'vitest';
import { SEED, SEED_USERNAME, fundWallet, intakeFor, signIn, usernameOf } from './helpers/http';

describe('SHP shipment tracking list', () => {
  async function createShipment(ownerEmail: string, recipientName: string) {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, ownerEmail, { typeClass: 'trading_card' });

    await fundWallet(ownerEmail, 100_000);
    const owner = await signIn(ownerEmail);
    const created = await owner.post('/shipping/shipments', {
      itemIds: [item.id],
      destinationAddress: `${recipientName}, 1 Test St, Testville 08608, US`,
      destinationCountry: 'US',
      destinationPostalCode: '08608',
      recipientName,
    });
    if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
    return { owner, shipment: created.body };
  }

  it('adds a newly created shipment to the tracking list automatically', async () => {
    const { owner, shipment } = await createShipment(SEED.collector, 'Red Ashwood');

    const list = (await owner.get('/shipping/shipments')).body as { id: string }[];
    expect(list.some((s) => s.id === shipment.id)).toBe(true);
  });

  it('carries every field the tracking list shows', async () => {
    const { owner, shipment } = await createShipment(SEED.collector, 'Red Ashwood');
    const list = (await owner.get('/shipping/shipments')).body as Record<string, unknown>[];
    const row = list.find((s) => s.id === shipment.id)!;

    expect(row.recipientName).toBe('Red Ashwood');
    expect(row.username).toBe(SEED_USERNAME.collector);
    expect(row.customerName).toBeTruthy();
    expect(row.createdAt).toBeTruthy();
    expect(row.status).toBe('requested');
    expect(row.code).toMatch(/^SHP-/);
    expect(row).toHaveProperty('carrier');
    expect(row).toHaveProperty('trackingNumber');
    expect(row).toHaveProperty('estimatedDeliveryAt');
    expect(row.estimatedDeliveryAt).toBeNull();
  });

  it('never exposes an intake ID on a tracking row', async () => {
    const { owner } = await createShipment(SEED.collector, 'Red Ashwood');
    const list = (await owner.get('/shipping/shipments')).body as Record<string, unknown>[];
    expect(list.length).toBeGreaterThan(0);
    for (const row of list) {
      expect(Object.keys(row)).not.toContain('intakeId');
      expect(JSON.stringify(row)).not.toMatch(/(^|[^A-Z0-9])OW-[A-HJ-NP-Z2-9]{6}(?![A-Z0-9])/);
    }
  });

  it('stamps a carrier ETA once a rate is selected', async () => {
    const { owner, shipment } = await createShipment(SEED.collector, 'Red Ashwood');

    const rates = (await owner.get(`/shipping/shipments/${shipment.id}/rates`)).body as {
      carrier: string;
      serviceLevel: string;
    }[];
    expect(rates.length).toBeGreaterThan(0);
    const selected = await owner.post(`/shipping/shipments/${shipment.id}/select-rate`, {
      carrier: rates[0]!.carrier,
      serviceLevel: rates[0]!.serviceLevel,
    });
    expect(selected.status).toBe(201);

    const list = (await owner.get('/shipping/shipments')).body as Record<string, unknown>[];
    const row = list.find((s) => s.id === shipment.id)!;
    expect(row.status).toBe('rates_selected');
    expect(row.carrier).toBe(rates[0]!.carrier);
    expect(row.estimatedDeliveryAt).toBeTruthy();
  });

  it('reflects a status change without anything being re-entered', async () => {
    const { owner, shipment } = await createShipment(SEED.collector, 'Red Ashwood');
    const before = (await owner.get('/shipping/shipments')).body as { id: string; status: string }[];
    expect(before.find((s) => s.id === shipment.id)?.status).toBe('requested');

    const rates = (await owner.get(`/shipping/shipments/${shipment.id}/rates`)).body as {
      carrier: string;
      serviceLevel: string;
    }[];
    await owner.post(`/shipping/shipments/${shipment.id}/select-rate`, {
      carrier: rates[0]!.carrier,
      serviceLevel: rates[0]!.serviceLevel,
    });

    const after = (await owner.get('/shipping/shipments')).body as { id: string; status: string }[];
    expect(after.find((s) => s.id === shipment.id)?.status).toBe('rates_selected');
  });

  it('preserves a shipment in the list after it has been dispatched', async () => {
    const owner = await signIn(SEED.collector2);
    const list = (await owner.get('/shipping/shipments')).body as { status: string }[];
    expect(list.some((s) => s.status === 'shipped')).toBe(true);
  });
});

describe('SHP tracking list authorization', () => {
  it('shows a collector only their own shipments', async () => {
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);

    const redUsername = await usernameOf(SEED.collector);
    const goldenUsername = await usernameOf(SEED.collector2);

    const redList = (await red.get('/shipping/shipments')).body as { username: string }[];
    const goldenList = (await golden.get('/shipping/shipments')).body as { username: string }[];

    expect(redList.every((s) => s.username === redUsername)).toBe(true);
    expect(goldenList.every((s) => s.username === goldenUsername)).toBe(true);
    expect(redList.some((s) => s.username === goldenUsername)).toBe(false);
  });

  it('shows staff every shipment', async () => {
    const operator = await signIn(SEED.operator);
    const red = await signIn(SEED.collector);

    const all = (await operator.get('/shipping/shipments')).body as { id: string }[];
    const mine = (await red.get('/shipping/shipments')).body as { id: string }[];
    expect(all.length).toBeGreaterThanOrEqual(mine.length);
    for (const shipment of mine) {
      expect(all.some((s) => s.id === shipment.id)).toBe(true);
    }
  });

  it('reports another collector shipment as not found rather than forbidden', async () => {
    const golden = await signIn(SEED.collector2);
    const goldenList = (await golden.get('/shipping/shipments')).body as { id: string }[];
    const target = goldenList[0];
    expect(target).toBeTruthy();

    const red = await signIn(SEED.collector);
    const res = await red.get(`/shipping/shipments/${target!.id}`);
    expect(res.status).toBe(404);
  });
});
