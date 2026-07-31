import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';

/**
 * US8 / Scenario H — create a MULTI-ITEM shipment request (Requirement 5.2) →
 * rates → select → scan-verified dispatch through the structured warehouse
 * fulfillment form (Requirement 5.3). Items move to `shipped` with a tracking
 * number; shipping is billed.
 */
describe('SHP outbound shipping', () => {
  /** The destination string the UI builds from a saved Profile address (Req 5.1). */
  const DESTINATION = 'Red, 1200 Market St, San Francisco 94102, US';

  const FULFILLMENT = {
    carrier: 'DHL',
    packageWeightGrams: 500,
    fulfillmentNotes: 'Slabs bubble-wrapped in a rigid mailer.',
  };

  it('ships a multi-item shipment end to end and bills the owner', async () => {
    const operator = await signIn(SEED.operator);
    const [itemA, itemB] = await Promise.all([
      intakeFor(operator, SEED.collector, { typeClass: 'Card' }),
      intakeFor(operator, SEED.collector, { typeClass: 'Card' }),
    ]);

    const collector = await signIn(SEED.collector);
    await collector.post('/finance/wallet/topups', { amountMinor: 100000 });

    // ONE request covering EVERY selected item, with one Shipment ID (Req 5.2).
    const shipment = (
      await collector.post('/shipping/shipments', {
        itemIds: [itemA.id, itemB.id],
        destinationAddress: DESTINATION,
      })
    ).body;
    expect(shipment.code).toMatch(/^SHP-/); // Requirement 9.4
    expect(shipment.itemIds).toHaveLength(2);

    const rates = (await collector.get(`/shipping/shipments/${shipment.id}/rates`)).body as {
      carrier: string;
      serviceLevel: string;
    }[];
    expect(rates.length).toBeGreaterThan(0);

    const selected = await collector.post(`/shipping/shipments/${shipment.id}/select-rate`, {
      carrier: rates[0].carrier,
      serviceLevel: rates[0].serviceLevel,
    });
    expect(selected.status).toBe(201);

    // Operator closes the request with the structured fulfillment form (Req 5.3).
    const dispatched = await operator.post(`/shipping/shipments/${shipment.id}/dispatch`, {
      scannedItemIds: [itemA.id, itemB.id],
      ...FULFILLMENT,
    });
    expect(dispatched.status).toBe(201);
    expect(dispatched.body.trackingNumber).toBeTruthy();

    const track = (await collector.get(`/shipping/shipments/${shipment.id}`)).body;
    expect(['shipped', 'in_transit', 'delivered']).toContain(track.status);
  });

  it('rejects dispatch when the scanned set does not match', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'Card' });
    const collector = await signIn(SEED.collector);
    await collector.post('/finance/wallet/topups', { amountMinor: 100000 });
    const shipment = (
      await collector.post('/shipping/shipments', {
        itemIds: [item.id],
        destinationAddress: DESTINATION,
      })
    ).body;
    const rates = (await collector.get(`/shipping/shipments/${shipment.id}/rates`)).body as {
      carrier: string;
      serviceLevel: string;
    }[];
    await collector.post(`/shipping/shipments/${shipment.id}/select-rate`, {
      carrier: rates[0].carrier,
      serviceLevel: rates[0].serviceLevel,
    });

    const bad = await operator.post(`/shipping/shipments/${shipment.id}/dispatch`, {
      scannedItemIds: ['wrong-item'],
      ...FULFILLMENT,
    });
    expect(bad.status).toBe(409);
  });

  it('rejects dispatch when the fulfillment form is incomplete (Requirement 5.3)', async () => {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'Card' });
    const collector = await signIn(SEED.collector);
    await collector.post('/finance/wallet/topups', { amountMinor: 100000 });
    const shipment = (
      await collector.post('/shipping/shipments', {
        itemIds: [item.id],
        destinationAddress: DESTINATION,
      })
    ).body;
    const rates = (await collector.get(`/shipping/shipments/${shipment.id}/rates`)).body as {
      carrier: string;
      serviceLevel: string;
    }[];
    await collector.post(`/shipping/shipments/${shipment.id}/select-rate`, {
      carrier: rates[0].carrier,
      serviceLevel: rates[0].serviceLevel,
    });

    // No carrier / weight / notes → the request cannot be closed.
    const incomplete = await operator.post(`/shipping/shipments/${shipment.id}/dispatch`, {
      scannedItemIds: [item.id],
    });
    expect(incomplete.status).toBe(400);
  });
});
