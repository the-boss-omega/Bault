import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from './helpers/http';

describe('VLT scopes cover every state', () => {
  interface Row {
    id: string;
    lifecycleState: string;
    historical?: boolean;
    departureReason?: string | null;
  }

  async function scope(c: Client, name: 'active' | 'hold' | 'history', q: string): Promise<Row[]> {
    const res = await c.get(`/vault/items?scope=${name}&q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    return res.body as Row[];
  }

  it('keeps a card shipped home in History (N2)', async () => {
    const tag = `N2-${Date.now()}`;
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { description: `${tag} shipped home` });
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 100_000);

    const shipment = (
      await collector.post('/shipping/shipments', {
        itemIds: [card.id],
        destinationAddress: 'Red, 1200 Market St, San Francisco 94102, US',
        destinationCountry: 'US',
        destinationPostalCode: '94102',
      })
    ).body;
    const rates = (await collector.get(`/shipping/shipments/${shipment.id}/rates`)).body as {
      carrier: string;
      serviceLevel: string;
      eligible: boolean;
    }[];
    const rate = rates.find((r) => r.eligible)!;
    const selected = await collector.post(`/shipping/shipments/${shipment.id}/select-rate`, {
      carrier: rate.carrier,
      serviceLevel: rate.serviceLevel,
    });
    expect(selected.status).toBe(201);
    const dispatched = await operator.post(`/shipping/shipments/${shipment.id}/dispatch`, {
      scannedItemIds: [card.id],
      carrier: rate.carrier,
      packageWeightGrams: 200,
      fulfillmentNotes: 'Top-loader in a bubble mailer.',
    });
    expect(dispatched.status).toBe(201);

    expect((await scope(collector, 'active', tag)).some((r) => r.id === card.id)).toBe(false);
    const history = await scope(collector, 'history', tag);
    const row = history.find((r) => r.id === card.id);
    expect(row, 'a card shipped home is missing from History').toBeDefined();
    expect(row!.lifecycleState).toBe('shipped');
    expect(row!.departureReason).toBeTruthy();
  });

  it('shows a card that is away at the grader with the cards the collector holds (F057)', async () => {
    const tag = `F057-grader-${Date.now()}`;
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { description: `${tag} at PSA` });
    const collector = await signIn(SEED.collector);

    const req = (
      await collector.post('/services/grading', { itemId: card.id, tier: 'psa_regular', declaredMinor: 40_000 })
    ).body;
    expect((await operator.post(`/services/requests/${req.id}/accept`)).status).toBe(201);
    const submission = (await operator.post('/services/grading/submissions', { gradingBody: 'PSA' })).body;
    await operator.post(`/services/grading/submissions/${submission.id}/add`, { requestId: req.id });
    const shipped = await operator.post(`/services/grading/submissions/${submission.id}/ship`, {
      trackingNumber: '9400111899223197428499',
      externalReference: 'PSA-SUB-F057',
      notes: 'One card.',
    });
    expect(shipped.status).toBe(201);

    const active = await scope(collector, 'active', tag);
    expect(active.find((r) => r.id === card.id)?.lifecycleState).toBe('at_grader');

    const counts = (await collector.get(`/vault/counts?q=${encodeURIComponent(tag)}`)).body;
    expect(counts.active).toBe(1);
  });

  it('keeps a discarded card in History rather than letting it vanish (F057)', async () => {
    const tag = `F057-discard-${Date.now()}`;
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { description: `${tag} common` });
    const collector = await signIn(SEED.collector);

    const challenge = (
      await collector.post('/services/remove-commons', { itemIds: [card.id], outcome: 'discard' })
    ).body;
    const done = await collector.post('/services/remove-commons/confirm', {
      confirmationToken: challenge.confirmationToken,
    });
    expect(done.status).toBe(201);

    const history = await scope(collector, 'history', tag);
    const row = history.find((r) => r.id === card.id);
    expect(row, 'a discarded card is missing from History').toBeDefined();
    expect(row!.lifecycleState).toBe('discarded');
    expect(row!.historical).toBe(true);
  });
});
