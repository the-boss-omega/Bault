import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn } from './helpers/http';

describe('MKT a committed card cannot be listed', () => {
  const list = async (itemId: string) => {
    const seller = await signIn(SEED.collector);
    return seller.post('/marketplace/listings', { itemId, askingPrice: 12_000 });
  };

  it('refuses a card that is in an open escrow deal', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const buyer = await signIn(SEED.collector2);
    await fundWallet(SEED.collector2, 110_000);

    const deal = (
      await seller.post('/escrow', {
        raiserRole: 'seller',
        counterpartyUsername: 'golden',
        description: 'Committed to escrow',
        valueMinor: 100_000,
        settlement: 'buyer_vault',
      })
    ).body;
    await buyer.post(`/escrow/${deal.id}/agree`, {});
    expect((await buyer.post(`/escrow/${deal.id}/fund`, {})).status).toBe(201);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    expect((await operator.post(`/escrow/${deal.id}/receive-item`, { itemId: card.id })).status).toBe(201);

    const res = await list(card.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('item_committed');
    expect(String(res.body.error.message)).toMatch(/escrow/i);
  });

  it('refuses a card that is in an open shipment, and allows it once that is called off', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const card = await intakeFor(operator, SEED.collector);

    const parcel = (
      await seller.post('/shipping/shipments', {
        itemIds: [card.id],
        destinationAddress: '12 Vine St, Trenton, NJ',
        destinationCountry: 'US',
        destinationPostalCode: '08608',
      })
    ).body;
    expect(parcel.id).toBeTruthy();

    const res = await list(card.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('item_committed');
    expect(String(res.body.error.message)).toMatch(/shipment/i);

    await seller.post(`/shipping/shipments/${parcel.id}/cancel`, { reason: 'Selling it instead.' });
    expect((await list(card.id)).status).toBe(201);
  });

  it('refuses a card with an open buyout request', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const card = await intakeFor(operator, SEED.collector);
    expect((await seller.post('/services/buyout', { itemId: card.id })).status).toBe(201);

    const res = await list(card.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('item_committed');
    expect(String(res.body.error.message)).toMatch(/buyout/i);
  });

  it('refuses a card with an open consignment request', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const card = await intakeFor(operator, SEED.collector);
    const consigned = await seller.post('/services/consignment', {
      itemId: card.id,
      channel: 'ebay_partner',
      askingMinor: 20_000,
    });
    expect(consigned.status).toBe(201);

    const res = await list(card.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('item_committed');
    expect(String(res.body.error.message)).toMatch(/consign/i);
  });

  it('still lists a card that is committed to nothing', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector);
    expect((await list(card.id)).status).toBe(201);
  });
});
