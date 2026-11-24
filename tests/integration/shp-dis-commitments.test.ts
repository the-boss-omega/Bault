import { afterAll, describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

const DESTINATION = {
  destinationAddress: 'Red, 1200 Market St, San Francisco 94102, US',
  destinationCountry: 'US',
  destinationPostalCode: '94102',
};

async function card(owner: string = SEED.collector) {
  const operator = await signIn(SEED.operator);
  return intakeFor(operator, owner, { typeClass: 'trading_card' });
}

async function openShipment(collector: Client, itemId: string) {
  const res = await collector.post('/shipping/shipments', { itemIds: [itemId], ...DESTINATION });
  expect(res.status).toBe(201);
  return res.body as { id: string; code: string };
}

async function paidShipment(collector: Client, itemId: string) {
  await fundWallet(SEED.collector, 100_000);
  const s = await openShipment(collector, itemId);
  const rates = (await collector.get(`/shipping/shipments/${s.id}/rates`)).body as {
    carrier: string;
    serviceLevel: string;
    eligible: boolean;
  }[];
  const pick = rates.find((r) => r.eligible)!;
  const selected = await collector.post(`/shipping/shipments/${s.id}/select-rate`, {
    carrier: pick.carrier,
    serviceLevel: pick.serviceLevel,
  });
  expect(selected.body.status).toBe('rates_selected');
  return s;
}

function expectCommitted(res: { status: number; body: { error?: { code?: string; message?: string } } }, where: RegExp) {
  expect(res.status).toBe(409);
  expect(res.body.error?.code).toBe('item_committed');
  expect(String(res.body.error?.message)).toMatch(where);
}

describe('SHP and DIS a card is committed to one thing at a time', () => {
  it('refuses to donate a card that is on a paid shipment, and leaves the card in the vault', async () => {
    const item = await card();
    const collector = await signIn(SEED.collector);
    await paidShipment(collector, item.id);

    expectCommitted(await collector.post('/services/donation', { itemId: item.id }), /shipment SHP-/i);
    const [row] = await sql<{ lifecycle_state: string }>('select lifecycle_state from item where id = $1', [item.id]);
    expect(row!.lifecycle_state).toBe('stored');
  });

  it('refuses a donation confirmed after the card went onto a shipment', async () => {
    const item = await card();
    const collector = await signIn(SEED.collector);
    const challenge = (await collector.post('/services/donation', { itemId: item.id })).body;
    expect(challenge.confirmationToken).toBeTruthy();
    await openShipment(collector, item.id);
    expectCommitted(
      await collector.post('/services/donation/confirm', { confirmationToken: challenge.confirmationToken }),
      /shipment/i,
    );
  });

  it('refuses a buyout, a consignment, a grading request, a cull, a swap and a gift for a card on an open shipment', async () => {
    const item = await card();
    const collector = await signIn(SEED.collector);
    await openShipment(collector, item.id);

    expectCommitted(await collector.post('/services/buyout', { itemId: item.id }), /shipment/i);
    expectCommitted(
      await collector.post('/services/consignment', { itemId: item.id, channel: 'ebay_partner', askingMinor: 20_000 }),
      /shipment/i,
    );
    expectCommitted(
      await collector.post('/services/grading', { itemId: item.id, tier: 'psa_regular', declaredMinor: 50_000 }),
      /shipment/i,
    );
    expectCommitted(
      await collector.post('/services/remove-commons', { itemIds: [item.id], outcome: 'discard' }),
      /shipment/i,
    );
    const responder = await signIn(SEED.collector2);
    const responderUsername = (await responder.get('/me/profile')).body.username as string;
    const theirs = await card(SEED.collector2);
    expectCommitted(
      await collector.post('/marketplace/swaps', {
        responderUsername,
        offeredItemIds: [item.id],
        requestedItemIds: [theirs.id],
      }),
      /shipment/i,
    );
    expectCommitted(
      await collector.post('/marketplace/transfers', { itemId: item.id, toUsername: responderUsername }),
      /shipment/i,
    );
  });

  it('refuses to put a card with an open buyout or consignment on a shipment', async () => {
    const collector = await signIn(SEED.collector);
    const bought = await card();
    expect((await collector.post('/services/buyout', { itemId: bought.id })).status).toBe(201);
    expectCommitted(await collector.post('/shipping/shipments', { itemIds: [bought.id], ...DESTINATION }), /buyout/i);

    const consigned = await card();
    const consignment = await collector.post('/services/consignment', {
      itemId: consigned.id,
      channel: 'ebay_partner',
      askingMinor: 20_000,
    });
    expect(consignment.status).toBe(201);
    expectCommitted(
      await collector.post('/shipping/shipments', { itemIds: [consigned.id], ...DESTINATION }),
      /consignment/i,
    );
  });

  it('refuses to list, ship or donate a card while its grading request is open', async () => {
    const item = await card();
    const collector = await signIn(SEED.collector);
    const graded = await collector.post('/services/grading', {
      itemId: item.id,
      tier: 'psa_regular',
      declaredMinor: 50_000,
    });
    expect(graded.status).toBe(201);

    expectCommitted(await collector.post('/marketplace/listings', { itemId: item.id, askingPrice: 12_000 }), /grading/i);
    expectCommitted(await collector.post('/shipping/shipments', { itemIds: [item.id], ...DESTINATION }), /grading/i);
    expectCommitted(await collector.post('/services/donation', { itemId: item.id }), /grading/i);
  });

  it('refuses to donate or ship a card offered in a pending swap', async () => {
    const item = await card();
    const collector = await signIn(SEED.collector);
    const responder = await signIn(SEED.collector2);
    const responderUsername = (await responder.get('/me/profile')).body.username as string;
    const theirs = await card(SEED.collector2);
    const swap = await collector.post('/marketplace/swaps', {
      responderUsername,
      offeredItemIds: [item.id],
      requestedItemIds: [theirs.id],
    });
    expect(swap.status).toBe(201);

    expectCommitted(await collector.post('/services/donation', { itemId: item.id }), /swap/i);
    expectCommitted(await collector.post('/shipping/shipments', { itemIds: [item.id], ...DESTINATION }), /swap/i);
  });
});
