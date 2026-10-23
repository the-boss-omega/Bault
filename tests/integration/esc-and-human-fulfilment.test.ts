import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from './helpers/http';

describe('ESC escrow and human fulfilment', () => {
  const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

  it('publishes what escrow costs and the floor under a deal', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/escrow/terms');
    expect(res.status).toBe(200);
    expect(res.body.feeBps).toBeGreaterThan(0);
    expect(res.body.minimumValueMinor).toBeGreaterThan(0);
  });

  it('refuses a deal below the floor, and one with no counterparty', async () => {
    const collector = await signIn(SEED.collector);

    const tooSmall = await collector.post('/escrow', {
      raiserRole: 'seller',
      counterpartyUsername: 'golden',
      description: 'A common',
      valueMinor: 1_000,
      settlement: 'ship_to_buyer',
    });
    expect(tooSmall.status).toBe(400);

    const noOtherSide = await collector.post('/escrow', {
      raiserRole: 'seller',
      description: 'A slab',
      valueMinor: 500_000,
      settlement: 'ship_to_buyer',
    });
    expect(noOtherSide.status).toBe(400);
  });

  it('refuses to put a card in a vault the external buyer does not have', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/escrow', {
      raiserRole: 'seller',
      counterpartyName: 'A Stranger',
      counterpartyEmail: 'stranger@example.test',
      description: '2003 EX Dragon Rayquaza ex #97/97, PSA 9',
      valueMinor: 900_000,
      settlement: 'buyer_vault',
    });
    expect(res.status).toBe(400);
  });

  it('will not let somebody be both sides of a deal', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/escrow', {
      raiserRole: 'seller',
      counterpartyUsername: 'red',
      description: 'A slab',
      valueMinor: 500_000,
      settlement: 'ship_to_buyer',
    });
    expect(res.status).toBe(400);
  });

  it('holds the buyer money, inspects the card, and settles both sides at once', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const buyer = await signIn(SEED.collector2);

    const VALUE = 400_000;
    await fundWallet(SEED.collector2, VALUE + 10_000);

    const deal = (
      await seller.post('/escrow', {
        raiserRole: 'seller',
        counterpartyUsername: 'golden',
        description: '2005 EX Deoxys Rayquaza Gold Star, PSA 8',
        valueMinor: VALUE,
        settlement: 'buyer_vault',
      })
    ).body;
    expect(deal.code).toMatch(/^ESC-/);
    expect(deal.status).toBe('proposed');
    expect(deal.feeMinor).toBeGreaterThan(0);

    const early = await buyer.post(`/escrow/${deal.id}/fund`, {});
    expect(early.status).toBe(409);

    expect((await buyer.post(`/escrow/${deal.id}/agree`, {})).status).toBe(201);

    const buyerBefore = await balanceOf(buyer);
    const heldBefore = (await buyer.get('/escrow/held')).body.heldMinor as number;
    const funded = await buyer.post(`/escrow/${deal.id}/fund`, {});
    expect(funded.status).toBe(201);
    expect(funded.body.source).toBe('wallet');

    expect(await balanceOf(buyer)).toBe(buyerBefore - VALUE);
    const held = (await buyer.get('/escrow/held')).body;
    expect(held.heldMinor).toBe(heldBefore + VALUE);

    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    expect((await operator.post(`/escrow/${deal.id}/receive-item`, { itemId: card.id })).status).toBe(201);

    const tooSoon = await buyer.post(`/escrow/${deal.id}/release`, {});
    expect(tooSoon.status).toBe(409);

    const inspected = await operator.post(`/escrow/${deal.id}/inspect`, {
      matches: true,
      notes: 'Slab intact, cert number matches, centring as described.',
    });
    expect(inspected.status).toBe(201);
    expect(inspected.body.matches).toBe(true);

    const oneSide = await buyer.post(`/escrow/${deal.id}/release`, {});
    expect(oneSide.body.status).toBe('awaiting_release');
    expect(oneSide.body.buyerReleased).toBe(true);
    expect(oneSide.body.sellerReleased).toBe(false);

    const sellerBefore = await balanceOf(seller);
    const settled = await seller.post(`/escrow/${deal.id}/release`, {});
    expect(settled.status).toBe(201);
    expect(settled.body.status).toBe('settled');

    expect(await balanceOf(seller)).toBe(sellerBefore + VALUE - deal.feeMinor);
    expect(await balanceOf(buyer)).toBe(buyerBefore - VALUE);
    expect((await buyer.get('/escrow/held')).body.heldMinor).toBe(heldBefore);

    const detail = (await buyer.get(`/escrow/${deal.id}`)).body;
    expect(detail.deal.status).toBe('settled');
    expect(detail.deal.itemId).toBe(card.id);
    const kinds = (detail.events as Array<{ eventType: string }>).map((e) => e.eventType);
    for (const step of ['raised', 'agreed', 'funded', 'item_received', 'inspected', 'settled']) {
      expect(kinds).toContain(step);
    }
  });

  it('returns the money when the card is not what it was said to be', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const buyer = await signIn(SEED.collector2);

    const VALUE = 200_000;
    await fundWallet(SEED.collector2, VALUE + 5_000);

    const deal = (
      await seller.post('/escrow', {
        raiserRole: 'seller',
        counterpartyUsername: 'golden',
        description: 'Described as PSA 10',
        valueMinor: VALUE,
        settlement: 'buyer_vault',
      })
    ).body;
    await buyer.post(`/escrow/${deal.id}/agree`, {});

    const before = await balanceOf(buyer);
    await buyer.post(`/escrow/${deal.id}/fund`, {});
    expect(await balanceOf(buyer)).toBe(before - VALUE);

    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    await operator.post(`/escrow/${deal.id}/receive-item`, { itemId: card.id });

    const inspected = await operator.post(`/escrow/${deal.id}/inspect`, {
      matches: false,
      notes: 'Slab is a PSA 8, not a PSA 10. Cert number does not match the listing.',
    });
    expect(inspected.body.matches).toBe(false);

    const returned = await buyer.post(`/escrow/${deal.id}/return`, {
      reason: 'Not the card that was described.',
    });
    expect(returned.status).toBe(201);
    expect(returned.body.refundedMinor).toBe(VALUE);

    expect(await balanceOf(buyer)).toBe(before);

    const detail = (await seller.get(`/escrow/${deal.id}`)).body;
    expect(detail.deal.status).toBe('returned');
    const stillMine = (await seller.get(`/vault/items/${card.id}`)).body;
    expect(stillMine.item.id).toBe(card.id);
  });

  it('refuses to hold money the buyer does not have', async () => {
    const seller = await signIn(SEED.collector);
    const broke = await signIn(SEED.collector3);

    const deal = (
      await seller.post('/escrow', {
        raiserRole: 'seller',
        counterpartyUsername: 'veteran',
        description: 'A slab well beyond an empty wallet',
        valueMinor: 5_000_000,
        settlement: 'ship_to_buyer',
      })
    ).body;
    await broke.post(`/escrow/${deal.id}/agree`, {});

    const res = await broke.post(`/escrow/${deal.id}/fund`, {});
    expect(res.status).toBe(409);
  });

  it('records an external party by attestation rather than inventing a ledger row', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);

    const deal = (
      await seller.post('/escrow', {
        raiserRole: 'seller',
        counterpartyName: 'Marcus Webb',
        counterpartyEmail: 'marcus@example.test',
        description: '2015 XY Roaring Skies M Rayquaza-EX #105/108, BGS 8.5',
        valueMinor: 800_000,
        settlement: 'ship_to_buyer',
      })
    ).body;

    const wrongHand = await seller.post(`/escrow/${deal.id}/agree`, {});
    expect(wrongHand.status).toBe(403);
    expect((await operator.post(`/escrow/${deal.id}/agree`, { notes: 'Confirmed by phone.' })).status).toBe(201);

    const noRef = await operator.post(`/escrow/${deal.id}/fund`, {});
    expect(noRef.status).toBe(400);

    const funded = await operator.post(`/escrow/${deal.id}/fund`, { reference: 'WISE-88213' });
    expect(funded.status).toBe(201);
    expect(funded.body.source).toBe('external');

    const detail = (await seller.get(`/escrow/${deal.id}`)).body;
    expect(detail.deal.fundingSource).toBe('external');
    expect(detail.deal.fundingAttestedBy).toBeTruthy();
    expect(detail.buyerId).toBeNull();
  });

  it('does not pay the seller of an outside buyer until the card is on its way to them', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const VALUE = 150_000;

    const deal = (
      await seller.post('/escrow', {
        raiserRole: 'seller',
        counterpartyName: 'Marcus Webb',
        counterpartyEmail: 'marcus@example.test',
        description: '2003 EX Dragon Rayquaza ex #97/97, PSA 9',
        valueMinor: VALUE,
        settlement: 'ship_to_buyer',
      })
    ).body;
    await operator.post(`/escrow/${deal.id}/agree`, { notes: 'Confirmed by phone.' });
    expect((await operator.post(`/escrow/${deal.id}/fund`, { reference: `WISE-${Date.now()}` })).status).toBe(201);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    expect((await operator.post(`/escrow/${deal.id}/receive-item`, { itemId: card.id })).status).toBe(201);
    await operator.post(`/escrow/${deal.id}/inspect`, { matches: true, notes: 'Slab and cert as described.' });
    expect((await seller.post(`/escrow/${deal.id}/release`, {})).status).toBe(201);

    const sellerBefore = await balanceOf(seller);
    const early = await operator.post(`/escrow/${deal.id}/release`, { side: 'buyer' });
    expect(early.status).toBe(409);
    expect(String(early.body.error.message)).toMatch(/ship|dispatch/i);
    expect(await balanceOf(seller)).toBe(sellerBefore);
    expect((await seller.get(`/escrow/${deal.id}`)).body.deal.status).toBe('awaiting_release');

    await fundWallet(SEED.collector, 20_000);
    const parcel = (
      await seller.post('/shipping/shipments', {
        itemIds: [card.id],
        destinationAddress: 'Marcus Webb, 400 Market St, San Francisco, CA',
        destinationCountry: 'US',
        destinationPostalCode: '94102',
      })
    ).body;
    const rates = (await seller.get(`/shipping/shipments/${parcel.id}/rates`)).body as Array<{
      carrier: string;
      serviceLevel: string;
      eligible: boolean;
    }>;
    const rate = rates.find((r) => r.eligible)!;
    expect(
      (await seller.post(`/shipping/shipments/${parcel.id}/select-rate`, {
        carrier: rate.carrier,
        serviceLevel: rate.serviceLevel,
      })).body.status,
    ).toBe('rates_selected');

    expect((await operator.post(`/escrow/${deal.id}/release`, { side: 'buyer' })).status).toBe(409);

    const dispatched = await operator.post(`/shipping/shipments/${parcel.id}/dispatch`, {
      scannedItemIds: [card.id],
      carrier: 'USPS',
      packageWeightGrams: 300,
      fulfillmentNotes: 'Slab in a rigid mailer, to the escrow buyer.',
    });
    expect(dispatched.status).toBe(201);

    const paidBefore = await balanceOf(seller);
    const settled = await operator.post(`/escrow/${deal.id}/release`, { side: 'buyer' });
    expect(settled.status).toBe(201);
    expect(settled.body.status).toBe('settled');
    expect(await balanceOf(seller)).toBe(paidBefore + VALUE - deal.feeMinor);
  }, 30_000);

  it('keeps a deal invisible to somebody who is not a party to it', async () => {
    const seller = await signIn(SEED.collector);
    const stranger = await signIn(SEED.collector3);

    const deal = (
      await seller.post('/escrow', {
        raiserRole: 'seller',
        counterpartyUsername: 'golden',
        description: 'Private',
        valueMinor: 500_000,
        settlement: 'ship_to_buyer',
      })
    ).body;

    const res = await stranger.get(`/escrow/${deal.id}`);
    expect(res.status).toBe(404);
  });

  it('quotes a hand delivery instead of pricing it from a rate card', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 200_000);

    const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

    const rushed = await collector.post('/shipping/white-glove', {
      itemIds: [card.id],
      pickupAddress: 'Bault NJ vault',
      pickupFrom: new Date(Date.now() + 3_600_000).toISOString(),
      pickupTo: new Date(Date.now() + 7_200_000).toISOString(),
      deliveryAddress: 'The Langham, Boston MA',
      deliverFrom: soon(2),
      deliverTo: soon(3),
      destinationCountry: 'US',
    });
    expect(rushed.status).toBe(400);

    const requested = await collector.post('/shipping/white-glove', {
      itemIds: [card.id],
      pickupAddress: 'Bault NJ vault',
      pickupFrom: soon(5),
      pickupTo: soon(6),
      deliveryAddress: 'The Langham, Boston MA',
      deliverFrom: soon(6),
      deliverTo: soon(7),
      destinationCountry: 'US',
      recipientName: 'Red Ashwood',
    });
    expect(requested.status).toBe(201);
    const shipmentId = requested.body.id as string;
    expect(requested.body.fulfilmentMethod).toBe('hand_delivery');
    expect(requested.body.quoteMinor).toBeNull();
    expect(requested.body.cost).toBeNull();

    const premature = await collector.post(`/shipping/white-glove/${shipmentId}/accept`);
    expect(premature.status).toBe(409);

    const quoted = await operator.post(`/shipping/white-glove/${shipmentId}/quote`, {
      quoteMinor: 118_000,
      notes: '$1,000 base plus $180 travel, Newark to Boston and back the same day.',
    });
    expect(quoted.status).toBe(201);

    const listed = ((await collector.get('/shipping/shipments')).body as Record<string, unknown>[]).find(
      (s) => s.id === shipmentId,
    );
    expect(listed).toMatchObject({
      fulfilmentMethod: 'hand_delivery',
      quoteMinor: 118_000,
      quoteNotes: '$1,000 base plus $180 travel, Newark to Boston and back the same day.',
    });

    const before = await balanceOf(collector);
    const accepted = await collector.post(`/shipping/white-glove/${shipmentId}/accept`);
    expect(accepted.status).toBe(201);
    expect(accepted.body.cost).toBe(118_000);
    expect(await balanceOf(collector)).toBe(before - 118_000);

    const handed = await operator.post(`/shipping/shipments/${shipmentId}/hand-over`, {
      scannedItemIds: [card.id],
      handedToName: 'Red Ashwood',
      notes: 'Handed over in the lobby, ID checked.',
    });
    expect(handed.status).toBe(201);
    expect(handed.body.status).toBe('delivered');

    const after = (await collector.get(`/shipping/shipments/${shipmentId}`)).body;
    expect(after.status).toBe('delivered');
    expect(after.trackingNumber).toBeNull();
  });

  it('lists only the shows that actually take pickups', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/shipping/pickup/shows');
    expect(res.status).toBe(200);
    const shows = res.body as Array<Record<string, unknown>>;
    expect(shows.length).toBeGreaterThan(0);
    for (const show of shows) {
      expect(typeof show.feeMinor).toBe('number');
      expect(typeof show.open).toBe('boolean');
      expect(show).toHaveProperty('remaining');
    }
  });

  it('books a pickup at a show and closes it with a hand-over', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 10_000);

    const shows = (await collector.get('/shipping/pickup/shows')).body as Array<{
      id: string;
      open: boolean;
      feeMinor: number;
      booked: number;
    }>;
    const show = shows.find((s) => s.open)!;
    expect(show).toBeTruthy();

    const before = await balanceOf(collector);
    const booked = await collector.post('/shipping/pickup', {
      itemIds: [card.id],
      eventId: show.id,
    });
    expect(booked.status).toBe(201);
    expect(booked.body.fulfilmentMethod).toBe('show_pickup');
    expect(await balanceOf(collector)).toBe(before - show.feeMinor);

    const after = (await collector.get('/shipping/pickup/shows')).body as Array<{ id: string; booked: number }>;
    expect(after.find((s) => s.id === show.id)!.booked).toBe(show.booked + 1);

    const handed = await operator.post(`/shipping/shipments/${booked.body.id}/hand-over`, {
      scannedItemIds: [card.id],
      handedToName: 'Red Ashwood',
      notes: 'Collected from the Bault table, ID checked.',
    });
    expect(handed.status).toBe(201);
    expect(handed.body.itemCount).toBe(1);
  });

  it('refuses a hand-over whose scanned set does not match', async () => {
    const operator = await signIn(SEED.operator);
    const a = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    const b = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab' });
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 10_000);

    const shows = (await collector.get('/shipping/pickup/shows')).body as Array<{ id: string; open: boolean }>;
    const booked = (
      await collector.post('/shipping/pickup', { itemIds: [a.id], eventId: shows.find((s) => s.open)!.id })
    ).body;

    const wrong = await operator.post(`/shipping/shipments/${booked.id}/hand-over`, {
      scannedItemIds: [b.id],
      handedToName: 'Red Ashwood',
      notes: 'Wrong card in the box.',
    });
    expect(wrong.status).toBe(409);
  });

  it('will not close a carrier shipment with a hand-over', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const collector = await signIn(SEED.collector);
    const addressId = (
      await collector.post('/me/addresses', {
        label: 'Handover test',
        recipient: 'Red Ashwood',
        line1: '12 Vine St',
        city: 'Trenton',
        region: 'NJ',
        country: 'US',
        postalCode: '08608',
      })
    ).body.id as string;

    const s = (await collector.post('/shipping/shipments', { itemIds: [card.id], addressId })).body;
    const res = await operator.post(`/shipping/shipments/${s.id}/hand-over`, {
      scannedItemIds: [card.id],
      handedToName: 'Somebody',
      notes: 'Should be refused — a parcel is closed by dispatch.',
    });
    expect(res.status).toBe(400);
  });
});
