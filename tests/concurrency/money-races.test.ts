import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from '../integration/helpers/http';

type Res = Awaited<ReturnType<Client['post']>>;

const ok = (r: Res) => r.status >= 200 && r.status < 300;
const wins = (rs: Res[]) => rs.filter(ok).length;
const losersAre4xx = (rs: Res[]) => rs.filter((r) => !ok(r)).every((r) => r.status >= 400 && r.status < 500);

const balanceOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

async function ensureBalance(email: string, min: number): Promise<number> {
  const c = await signIn(email);
  let cur = await balanceOf(c);
  while (cur < min) {
    await fundWallet(email, Math.min(Math.max(min - cur, 1_000), 2_000_000));
    cur = await balanceOf(c);
  }
  return cur;
}

async function setBalance(email: string, target: number): Promise<void> {
  const cur = await ensureBalance(email, target);
  if (cur > target) {
    const sellerEmail = email === SEED.collector ? SEED.collector2 : SEED.collector;
    const operator = await signIn(SEED.operator);
    const seller = await signIn(sellerEmail);
    const buyer = await signIn(email);
    const card = await intakeFor(operator, sellerEmail, { description: 'balance drain' });
    const listing = await seller.post('/marketplace/listings', { itemId: card.id, askingPrice: cur - target });
    expect(listing.status).toBe(201);
    expect((await buyer.post(`/marketplace/listings/${listing.body.id}/purchase`)).status).toBe(201);
  }
  expect(await balanceOf(await signIn(email))).toBe(target);
}

async function carrierShipment(ownerEmail: string, description: string) {
  const operator = await signIn(SEED.operator);
  const card = await intakeFor(operator, ownerEmail, { typeClass: 'trading_card', description });
  const owner = await signIn(ownerEmail);
  const created = await owner.post('/shipping/shipments', {
    itemIds: [card.id],
    destinationAddress: 'Red, 1200 Market St, San Francisco 94102, US',
    destinationCountry: 'US',
    destinationPostalCode: '94102',
  });
  expect(created.status).toBe(201);
  const rates = (await owner.get(`/shipping/shipments/${created.body.id}/rates`)).body as Array<{
    carrier: string;
    serviceLevel: string;
    eligible: boolean;
    totalMinor: number;
  }>;
  const eligible = rates.filter((r) => r.eligible);
  expect(eligible.length).toBeGreaterThan(0);
  return { owner, card, shipmentId: created.body.id as string, eligible };
}

const ESC_VALUE = 100_000;

async function agreedDeal(description: string) {
  const seller = await signIn(SEED.collector);
  const buyer = await signIn(SEED.collector2);
  const raised = await seller.post('/escrow', {
    raiserRole: 'seller',
    counterpartyUsername: 'golden',
    description,
    valueMinor: ESC_VALUE,
    settlement: 'buyer_vault',
  });
  expect(raised.status).toBe(201);
  expect((await buyer.post(`/escrow/${raised.body.id}/agree`, {})).status).toBe(201);
  return { seller, buyer, deal: raised.body as { id: string; feeMinor: number } };
}

async function dealAwaitingRelease(description: string) {
  const { seller, buyer, deal } = await agreedDeal(description);
  await ensureBalance(SEED.collector2, ESC_VALUE);
  expect((await buyer.post(`/escrow/${deal.id}/fund`, {})).status).toBe(201);

  const operator = await signIn(SEED.operator);
  const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description });
  expect((await operator.post(`/escrow/${deal.id}/receive-item`, { itemId: card.id })).status).toBe(201);
  const inspected = await operator.post(`/escrow/${deal.id}/inspect`, {
    matches: true,
    notes: 'Slab intact, cert number matches.',
  });
  expect(inspected.status).toBe(201);
  expect(inspected.body.status).toBe('awaiting_release');
  return { seller, buyer, deal, card };
}

const dealStatus = async (c: Client, dealId: string) =>
  ((await c.get(`/escrow/${dealId}`)).body as { deal: { status: string } }).deal.status;

describe('concurrency: money races', () => {
  it('a balance that covers one listing buys exactly one of eight', async () => {
    const operator = await signIn(SEED.operator);
    const seller = await signIn(SEED.collector);
    const buyer = await signIn(SEED.collector3);
    await ensureBalance(SEED.collector3, 1_000);
    const price = await balanceOf(buyer);

    const ids = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const item = await intakeFor(operator, SEED.collector, { description: `E1 ${i}` });
        const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: price });
        expect(listing.status).toBe(201);
        return listing.body.id as string;
      }),
    );

    const res = await Promise.all(ids.map((id) => buyer.post(`/marketplace/listings/${id}/purchase`)));
    const after = await balanceOf(buyer);

    expect({ wins: wins(res), spent: price - after }).toEqual({ wins: 1, spent: price });
    expect(after).toBeGreaterThanOrEqual(0);
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('funding an escrow deal twice holds the money once', async () => {
    const { buyer, deal } = await agreedDeal('Escrow double fund');
    await ensureBalance(SEED.collector2, ESC_VALUE);
    const before = await balanceOf(buyer);

    const res = await Promise.all(Array.from({ length: 6 }, () => buyer.post(`/escrow/${deal.id}/fund`, {})));
    const after = await balanceOf(buyer);

    expect({ wins: wins(res), debited: before - after }).toEqual({ wins: 1, debited: ESC_VALUE });
    expect(losersAre4xx(res)).toBe(true);
    expect(await dealStatus(buyer, deal.id)).toBe('funded');
  }, 60_000);

  it('both sides releasing at once pays the seller exactly once', async () => {
    const { seller, buyer, deal } = await dealAwaitingRelease('Escrow release race');
    const sellerBefore = await balanceOf(seller);
    const buyerBefore = await balanceOf(buyer);

    const calls: Promise<Res>[] = [];
    for (let i = 0; i < 5; i++) {
      calls.push(buyer.post(`/escrow/${deal.id}/release`, {}));
      calls.push(seller.post(`/escrow/${deal.id}/release`, {}));
    }
    const res = await Promise.all(calls);

    expect({
      sellerCredited: (await balanceOf(seller)) - sellerBefore,
      buyerMoved: (await balanceOf(buyer)) - buyerBefore,
      status: await dealStatus(seller, deal.id),
    }).toEqual({ sellerCredited: ESC_VALUE - deal.feeMinor, buyerMoved: 0, status: 'settled' });
    expect(res.filter((r) => r.body?.status === 'settled')).toHaveLength(1);
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('the second side releasing twice pays the seller once', async () => {
    const { seller, buyer, deal } = await dealAwaitingRelease('Escrow double release');
    const first = await seller.post(`/escrow/${deal.id}/release`, {});
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('awaiting_release');
    const sellerBefore = await balanceOf(seller);

    const res = await Promise.all(Array.from({ length: 6 }, () => buyer.post(`/escrow/${deal.id}/release`, {})));

    expect({
      wins: wins(res),
      sellerCredited: (await balanceOf(seller)) - sellerBefore,
      status: await dealStatus(seller, deal.id),
    }).toEqual({ wins: 1, sellerCredited: ESC_VALUE - deal.feeMinor, status: 'settled' });
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('a release and a return racing move the money one way only', async () => {
    const { seller, buyer, deal } = await dealAwaitingRelease('Escrow release vs return');
    const sellerReleased = await seller.post(`/escrow/${deal.id}/release`, {});
    expect(sellerReleased.status).toBe(201);
    expect(sellerReleased.body.status).toBe('awaiting_release');

    const sellerBefore = await balanceOf(seller);
    const buyerBefore = await balanceOf(buyer);

    const calls: Promise<Res>[] = [];
    for (let i = 0; i < 3; i++) {
      calls.push(buyer.post(`/escrow/${deal.id}/release`, {}));
      calls.push(buyer.post(`/escrow/${deal.id}/return`, { reason: 'Changed my mind at the last moment.' }));
    }
    const res = await Promise.all(calls);

    const sellerDelta = (await balanceOf(seller)) - sellerBefore;
    const buyerDelta = (await balanceOf(buyer)) - buyerBefore;
    const status = await dealStatus(seller, deal.id);

    const settled = { wins: 1, sellerDelta: ESC_VALUE - deal.feeMinor, buyerDelta: 0, status: 'settled' };
    const returned = { wins: 1, sellerDelta: 0, buyerDelta: ESC_VALUE, status: 'returned' };
    expect([settled, returned]).toContainEqual({ wins: wins(res), sellerDelta, buyerDelta, status });
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('choosing a rate again on a paid shipment is refused and charges nothing', async () => {
    await ensureBalance(SEED.collector, 100_000);
    const { owner, shipmentId, eligible } = await carrierShipment(SEED.collector, 'Paid shipment re-rate');
    const first = eligible[0]!;
    const second = eligible[1] ?? first;

    const before = await balanceOf(owner);
    const selected = await owner.post(`/shipping/shipments/${shipmentId}/select-rate`, {
      carrier: first.carrier,
      serviceLevel: first.serviceLevel,
    });
    expect(selected.status).toBe(201);
    expect(selected.body.status).toBe('rates_selected');
    const paid = await balanceOf(owner);
    expect(before - paid).toBe(first.totalMinor);

    const again = await owner.post(`/shipping/shipments/${shipmentId}/select-rate`, {
      carrier: second.carrier,
      serviceLevel: second.serviceLevel,
    });
    expect({ status: again.status, chargedAgain: paid - (await balanceOf(owner)) }).toEqual({
      status: 409,
      chargedAgain: 0,
    });
  }, 60_000);

  it('two clicks on a rate charge the shipment once', async () => {
    await ensureBalance(SEED.collector, 100_000);
    const { owner, shipmentId, eligible } = await carrierShipment(SEED.collector, 'Select-rate double click');
    const pick = eligible[0]!;
    const before = await balanceOf(owner);

    const res = await Promise.all(
      Array.from({ length: 6 }, () =>
        owner.post(`/shipping/shipments/${shipmentId}/select-rate`, {
          carrier: pick.carrier,
          serviceLevel: pick.serviceLevel,
        }),
      ),
    );
    const after = await balanceOf(owner);

    expect({ wins: wins(res), charged: before - after }).toEqual({ wins: 1, charged: pick.totalMinor });
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('paying a held shipment twice charges it once', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector3, { typeClass: 'trading_card', description: 'Pay race' });
    await setBalance(SEED.collector3, 0);
    const owner = await signIn(SEED.collector3);

    const created = await owner.post('/shipping/shipments', {
      itemIds: [card.id],
      destinationAddress: 'Veteran, 1200 Market St, San Francisco 94102, US',
      destinationCountry: 'US',
      destinationPostalCode: '94102',
    });
    expect(created.status).toBe(201);
    const shipmentId = created.body.id as string;
    const rates = (await owner.get(`/shipping/shipments/${shipmentId}/rates`)).body as Array<{
      carrier: string;
      serviceLevel: string;
      eligible: boolean;
      totalMinor: number;
    }>;
    const pick = rates.find((r) => r.eligible)!;
    expect(pick).toBeTruthy();

    const held = await owner.post(`/shipping/shipments/${shipmentId}/select-rate`, {
      carrier: pick.carrier,
      serviceLevel: pick.serviceLevel,
    });
    expect(held.status).toBe(201);
    expect(held.body.status).toBe('awaiting_payment');
    const cost = held.body.cost as number;
    expect(cost).toBe(pick.totalMinor);

    await fundWallet(SEED.collector3, Math.max(cost, 1_000));
    const before = await balanceOf(owner);
    expect(before).toBeGreaterThanOrEqual(cost);

    const res = await Promise.all(
      Array.from({ length: 6 }, () => owner.post(`/shipping/shipments/${shipmentId}/pay`)),
    );
    const after = await balanceOf(owner);

    expect({ wins: wins(res), charged: before - after }).toEqual({ wins: 1, charged: cost });
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('accepting a hand-delivery quote twice charges it once', async () => {
    const QUOTE = 50_000;
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description: 'Hand delivery race' });
    const collector = await signIn(SEED.collector);
    await ensureBalance(SEED.collector, QUOTE + 10_000);

    const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
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
    const quoted = await operator.post(`/shipping/white-glove/${shipmentId}/quote`, {
      quoteMinor: QUOTE,
      notes: 'Base plus travel, Newark to Boston and back the same day.',
    });
    expect(quoted.status).toBe(201);

    const before = await balanceOf(collector);
    const res = await Promise.all(
      Array.from({ length: 6 }, () => collector.post(`/shipping/white-glove/${shipmentId}/accept`, { quoteMinor: QUOTE })),
    );
    const after = await balanceOf(collector);

    expect({ wins: wins(res), charged: before - after }).toEqual({ wins: 1, charged: QUOTE });
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('booking the same cards for a show pickup twice books and charges once', async () => {
    const operator = await signIn(SEED.operator);
    const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', description: 'Pickup race' });
    const collector = await signIn(SEED.collector);
    await ensureBalance(SEED.collector, 20_000);

    const shows = (await collector.get('/shipping/pickup/shows')).body as Array<{
      id: string;
      open: boolean;
      feeMinor: number;
      booked: number;
      remaining: number | null;
    }>;
    const show = shows.find((s) => s.open);
    expect(show).toBeTruthy();
    const copies = Math.min(5, show!.remaining ?? 5);
    expect(copies).toBeGreaterThanOrEqual(2);

    const before = await balanceOf(collector);
    const res = await Promise.all(
      Array.from({ length: copies }, () =>
        collector.post('/shipping/pickup', { itemIds: [card.id], eventId: show!.id }),
      ),
    );
    const after = await balanceOf(collector);
    const bookedAfter = ((await collector.get('/shipping/pickup/shows')).body as Array<{ id: string; booked: number }>).find(
      (s) => s.id === show!.id,
    )!.booked;

    expect({ wins: wins(res), charged: before - after, newBookings: bookedAfter - show!.booked }).toEqual({
      wins: 1,
      charged: show!.feeMinor,
      newBookings: 1,
    });
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('accepting a custom-request quote twice charges it once', async () => {
    const PRICE = 2_500;
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const card = await intakeFor(operator, SEED.collector, { description: 'Custom quote race' });
    await ensureBalance(SEED.collector, PRICE + 10_000);

    const created = await owner.post('/services/custom', {
      itemId: card.id,
      summary: 'Sleeve before shipping',
      detail: 'Please put this in a penny sleeve and a toploader before it goes out.',
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect((await operator.post(`/services/requests/${id}/accept`, {})).status).toBe(201);
    expect(
      (await operator.post(`/services/custom/${id}/quote`, {
        priceMinor: PRICE,
        scope: 'Penny sleeve plus toploader, fitted before packing.',
      })).status,
    ).toBe(201);

    const before = await balanceOf(owner);
    const res = await Promise.all(
      Array.from({ length: 6 }, () => owner.post(`/services/custom/${id}/accept-quote`, {})),
    );
    const after = await balanceOf(owner);

    expect({ wins: wins(res), charged: before - after }).toEqual({ wins: 1, charged: PRICE });
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('accepting a buyout offer twice credits the owner once', async () => {
    const OFFER = 30_000;
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const card = await intakeFor(operator, SEED.collector, { description: 'Buyout race' });
    await ensureBalance(SEED.collector, 10_000);

    const requested = await owner.post('/services/buyout', { itemId: card.id });
    expect(requested.status).toBe(201);
    const id = requested.body.id as string;
    expect((await operator.post(`/services/requests/${id}/accept`, {})).status).toBe(201);
    expect(
      (await operator.post(`/services/buyout/${id}/quote`, {
        offerMinor: OFFER,
        rationale: 'Centred, sharp corners, light surface wear.',
        itemVerified: true,
      })).status,
    ).toBe(201);

    const before = await balanceOf(owner);
    const res = await Promise.all(Array.from({ length: 6 }, () => owner.post(`/services/buyout/${id}/accept`, {})));
    const after = await balanceOf(owner);

    expect({ wins: wins(res), credited: after - before }).toEqual({ wins: 1, credited: OFFER });
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);

  it('sending one parcel direct overnight twice charges it once', async () => {
    const collector = await signIn(SEED.collector);
    const operator = await signIn(SEED.operator);
    const address = await collector.post('/me/addresses', {
      label: 'Trenton',
      recipient: 'Red Ashwood',
      line1: '12 Vine St',
      city: 'Trenton',
      region: 'NJ',
      country: 'US',
      postalCode: '08608',
    });
    expect(address.status).toBe(201);
    await ensureBalance(SEED.collector, 200_000);

    const registered = await collector.post('/me/parcels', {
      facilityCode: 'DE',
      carrier: 'UPS',
      trackingNumber: `DIRECT-RACE-${Date.now()}`,
      declaredContents: 'Two slabs',
    });
    expect(registered.status).toBe(201);
    const parcelId = registered.body.id as string;
    expect(
      (await operator.post('/parcels/receive', {
        facilityCode: 'DE',
        addressedTo: 'red',
        trackingNumber: registered.body.trackingNumber,
      })).status,
    ).toBe(201);

    const before = await balanceOf(collector);
    const res = await Promise.all(
      Array.from({ length: 6 }, () =>
        collector.post(`/shipping/direct/${parcelId}`, { addressId: address.body.id, cardCount: 2 }),
      ),
    );
    const after = await balanceOf(collector);

    expect(wins(res)).toBe(1);
    const cost = (res.find(ok)!.body as { costMinor: number }).costMinor;
    expect(before - after).toBe(cost);
    expect(losersAre4xx(res)).toBe(true);
  }, 60_000);
});
