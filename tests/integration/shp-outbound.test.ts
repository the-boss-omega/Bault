import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from './helpers/http';

/**
 * Section 8 — outbound shipping.
 *
 * The old flow's shape was right and almost everything inside it was synthetic:
 * two invented prices that were the same two prices for every parcel Bault had
 * ever quoted, because the rate request hard-coded the destination and assumed
 * 500 g per item.
 *
 * So the tests worth having are the ones that would still pass against the old
 * stub if the change were cosmetic: a quote that MOVES when the parcel gets
 * heavier or the destination gets further, a service that refuses a parcel it
 * cannot legally carry, an insurance figure that forces a signature, and a
 * request that can be changed, merged and called off after it exists.
 *
 * Requires a running API + a freshly seeded DB.
 */
describe('SHP outbound shipping', () => {
  async function itemFor(cls = 'trading_card', weightGrams?: number) {
    const operator = await signIn(SEED.operator);
    const it = await intakeFor(operator, SEED.collector, {
      typeClass: cls,
      ...(weightGrams ? { weightGrams } : {}),
    });
    return { operator, item: it };
  }

  async function addressFor(client: Client, body: Record<string, unknown>) {
    const res = await client.post('/me/addresses', body);
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  const US = {
    label: 'Trenton',
    recipient: 'Red Ashwood',
    line1: '12 Vine St',
    city: 'Trenton',
    country: 'US',
    postalCode: '08608',
  };
  const JP = {
    label: 'Tokyo',
    recipient: 'Red Ashwood',
    line1: '1-1 Chiyoda',
    city: 'Tokyo',
    country: 'JP',
    postalCode: '100-0001',
  };

  /* ---------------- quoting ---------------- */

  it('publishes the carrier line-up with the limits that decide what you can use', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/shipping/services');
    expect(res.status).toBe(200);

    const services = res.body.services as Array<Record<string, unknown>>;
    expect(services.length).toBeGreaterThan(3);
    // The limits ARE the product — a line-up without them is the old stub.
    for (const s of services) {
      expect(typeof s.maxWeightGrams).toBe('number');
      expect(typeof s.maxInsuredValueMinor).toBe('number');
      expect(['domestic', 'international']).toContain(s.scope);
    }
    expect(res.body.signatureRequiredAboveMinor).toBeGreaterThan(0);
  });

  it('prices a parcel without creating one', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const addressId = await addressFor(collector, US);

    const before = ((await collector.get('/shipping/shipments')).body as unknown[]).length;
    const quote = (await collector.post('/shipping/quote', { itemIds: [item.id], addressId })).body;

    expect(quote.rates.length).toBeGreaterThan(0);
    expect(quote.destination.country).toBe('US');
    // Nothing was created — that is the entire point of a quote.
    const after = ((await collector.get('/shipping/shipments')).body as unknown[]).length;
    expect(after).toBe(before);
  });

  it('quotes more for a heavier parcel and more again for a further one', async () => {
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);
    const jp = await addressFor(collector, JP);
    const { item: card } = await itemFor('trading_card');
    const { item: box } = await itemFor('sealed_box');

    const cheapest = (q: { rates: { eligible: boolean; totalMinor: number }[] }) =>
      Math.min(...q.rates.filter((r) => r.eligible).map((r) => r.totalMinor));

    const lightHome = (await collector.post('/shipping/quote', { itemIds: [card.id], addressId: us })).body;
    const heavyHome = (await collector.post('/shipping/quote', { itemIds: [box.id], addressId: us })).body;
    const lightFar = (
      await collector.post('/shipping/quote', {
        itemIds: [card.id],
        addressId: jp,
        declaredValueMinor: 10_000,
      })
    ).body;

    expect(heavyHome.totalWeightGrams).toBeGreaterThan(lightHome.totalWeightGrams);
    expect(cheapest(heavyHome)).toBeGreaterThan(cheapest(lightHome));
    expect(cheapest(lightFar)).toBeGreaterThan(cheapest(lightHome));
  });

  it('charges more for rush, as a Bault handling line rather than a carrier one', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);

    const standard = (await collector.post('/shipping/quote', { itemIds: [item.id], addressId: us })).body;
    const rushed = (
      await collector.post('/shipping/quote', { itemIds: [item.id], addressId: us, rush: true })
    ).body;

    const pick = (q: { rates: { serviceKey: string; handlingMinor: number; totalMinor: number; estimatedDays: number }[] }) =>
      q.rates.find((r) => r.serviceKey === 'usps_ground')!;

    const a = pick(standard);
    const b = pick(rushed);
    expect(b.totalMinor).toBeGreaterThan(a.totalMinor);
    // The surcharge sits in HANDLING, and the carrier's own promise is unchanged
    // — rush is Bault packing faster, not FedEx flying faster.
    expect(b.handlingMinor).toBeGreaterThan(a.handlingMinor);
    expect(b.estimatedDays).toBe(a.estimatedDays);
  });

  it('refuses a service that cannot legally carry the parcel, and says which rule', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const jp = await addressFor(collector, JP);

    const quote = (
      await collector.post('/shipping/quote', {
        itemIds: [item.id],
        addressId: jp,
        declaredValueMinor: 300_000, // $3,000 — far over ePacket's $400
        insuredValueMinor: 300_000,
      })
    ).body;

    const epacket = quote.rates.find((r: { serviceKey: string }) => r.serviceKey === 'epacket');
    expect(epacket.eligible).toBe(false);
    const rules = epacket.problems.map((p: { rule: string }) => p.rule);
    expect(rules).toContain('customs_value');
    expect(rules).toContain('insurance');

    // Something still can carry it — a refusal everywhere would be a dead end.
    expect(quote.rates.some((r: { eligible: boolean }) => r.eligible)).toBe(true);
    expect(quote.rates.some((r: { recommended: boolean }) => r.recommended)).toBe(true);
  });

  it('will not send an international parcel without a customs value', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const jp = await addressFor(collector, JP);

    const quote = (await collector.post('/shipping/quote', { itemIds: [item.id], addressId: jp })).body;
    expect(quote.optionProblems.some((p: { field: string }) => p.field === 'customsValueMinor')).toBe(true);

    const created = await collector.post('/shipping/shipments', { itemIds: [item.id], addressId: jp });
    expect(created.status).toBe(400);
  });

  it('forces a signature once the insured value passes the threshold', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);

    // Asked for $2,000 of cover and no signature — the signature is not refused,
    // it is applied, because the cover would not pay without one.
    const created = (
      await collector.post('/shipping/shipments', {
        itemIds: [item.id],
        addressId: us,
        insuredValueMinor: 200_000,
        signatureRequired: false,
      })
    ).body;
    expect(created.signatureRequired).toBe(true);
    expect(created.insuredValueMinor).toBe(200_000);
  });

  it('refuses to insure past the ceiling', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);
    const res = await collector.post('/shipping/shipments', {
      itemIds: [item.id],
      addressId: us,
      insuredValueMinor: 900_000, // $9,000 against a $5,000 cap
      signatureRequired: true,
    });
    expect(res.status).toBe(400);
  });

  it('will not sell a tracker on an uninsured parcel', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);
    const res = await collector.post('/shipping/shipments', {
      itemIds: [item.id],
      addressId: us,
      addOns: ['gps_tracker'],
    });
    expect(res.status).toBe(400);
  });

  /* ---------------- changing a request ---------------- */

  it('adds and removes items while the request has not been picked', async () => {
    const { item: a } = await itemFor();
    const { item: b } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);

    const s = (await collector.post('/shipping/shipments', { itemIds: [a.id], addressId: us })).body;
    const widened = await collector.patch(`/shipping/shipments/${s.id}`, { itemIds: [a.id, b.id] });
    expect(widened.status).toBe(200);
    expect((widened.body.itemIds as string[]).sort()).toEqual([a.id, b.id].sort());

    const narrowed = await collector.patch(`/shipping/shipments/${s.id}`, {
      itemIds: [b.id],
      customerNotes: 'Leave it with the neighbour at number 14.',
    });
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.itemIds).toEqual([b.id]);
    expect(narrowed.body.customerNotes).toContain('neighbour');
  });

  it('refuses to put the same item on two open shipments', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);

    const first = await collector.post('/shipping/shipments', { itemIds: [item.id], addressId: us });
    expect(first.status).toBe(201);
    const second = await collector.post('/shipping/shipments', { itemIds: [item.id], addressId: us });
    expect(second.status).toBe(409);
  });

  it('merges two same-address requests and points the absorbed one at its new home', async () => {
    const { item: a } = await itemFor();
    const { item: b } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);

    const target = (await collector.post('/shipping/shipments', { itemIds: [a.id], addressId: us })).body;
    const source = (await collector.post('/shipping/shipments', { itemIds: [b.id], addressId: us })).body;

    const merged = await collector.post(`/shipping/shipments/${target.id}/merge`, {
      sourceShipmentId: source.id,
    });
    expect(merged.status).toBe(201);
    expect(merged.body.itemCount).toBe(2);

    const after = (await collector.get(`/shipping/shipments/${target.id}`)).body;
    expect((after.itemIds as string[]).sort()).toEqual([a.id, b.id].sort());

    // The absorbed request is not deleted — somebody wrote its code down.
    const absorbed = (await collector.get(`/shipping/shipments/${source.id}`)).body;
    expect(absorbed.status).toBe('cancelled');
    expect(absorbed.mergedIntoShipmentId).toBe(target.id);
  });

  it('refuses to merge two requests going to different addresses', async () => {
    const { item: a } = await itemFor();
    const { item: b } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);
    const jp = await addressFor(collector, JP);

    const target = (await collector.post('/shipping/shipments', { itemIds: [a.id], addressId: us })).body;
    const source = (
      await collector.post('/shipping/shipments', {
        itemIds: [b.id],
        addressId: jp,
        declaredValueMinor: 5_000,
      })
    ).body;

    const merged = await collector.post(`/shipping/shipments/${target.id}/merge`, {
      sourceShipmentId: source.id,
    });
    expect(merged.status).toBe(400);
  });

  it('cancels an unpicked request for nothing, and frees its items', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);

    const s = (await collector.post('/shipping/shipments', { itemIds: [item.id], addressId: us })).body;
    const cancelled = await collector.post(`/shipping/shipments/${s.id}/cancel`, {
      reason: 'Picked the wrong card.',
    });
    expect(cancelled.status).toBe(201);
    // Nothing had been done, so nothing is owed.
    expect(cancelled.body.restockingFeeMinor).toBe(0);

    // And the item can go on a new request, which is what cancelling is FOR.
    const again = await collector.post('/shipping/shipments', { itemIds: [item.id], addressId: us });
    expect(again.status).toBe(201);
  });

  it('charges a restocking fee to cancel a request that was already paid for', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);
    await fundWallet(SEED.collector, 20_000);

    const s = (await collector.post('/shipping/shipments', { itemIds: [item.id], addressId: us })).body;
    const rates = (await collector.get(`/shipping/shipments/${s.id}/rates`)).body as Array<{
      carrier: string;
      serviceLevel: string;
      eligible: boolean;
    }>;
    const pick = rates.find((r) => r.eligible)!;
    const selected = await collector.post(`/shipping/shipments/${s.id}/select-rate`, {
      carrier: pick.carrier,
      serviceLevel: pick.serviceLevel,
    });
    expect(selected.body.status).toBe('rates_selected');

    const cancelled = await collector.post(`/shipping/shipments/${s.id}/cancel`, {
      reason: 'Changed my mind after it was queued.',
    });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.restockingFeeMinor).toBeGreaterThan(0);
  });

  /* ---------------- choosing, and paying ---------------- */

  it('picks a carrier for you and records that it did', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);
    await fundWallet(SEED.collector, 20_000);

    const s = (await collector.post('/shipping/shipments', { itemIds: [item.id], addressId: us })).body;
    const chosen = await collector.post(`/shipping/shipments/${s.id}/choose-for-me`);
    expect(chosen.status).toBe(201);
    expect(chosen.body.carrier).toBeTruthy();

    const after = (await collector.get(`/shipping/shipments/${s.id}`)).body;
    // Who decided is answerable-for, so it is recorded rather than inferred.
    expect(after.serviceMode).toBe('simple');
  });

  it('holds a shipment the wallet cannot cover instead of forcing it into debt', async () => {
    // `veteran` is seeded with an empty wallet. It is topped up by exactly the
    // intake fee — enough to stay positive, since a NEGATIVE balance would block
    // the request outright and the condition under test is the narrower one: a
    // collector who can raise a request and cannot pay the postage.
    //
    // Three sealed cases to Australia, insured to the ceiling, so the total is
    // unambiguously beyond a wallet holding small change. Every top-up below is
    // spent exactly, so running this suite twice against one database does not
    // leave a balance behind that would defeat it.
    await fundWallet(SEED.collector3, 6_000);
    const operator = await signIn(SEED.operator);
    const cases = [];
    for (let i = 0; i < 3; i += 1) {
      cases.push(await intakeFor(operator, SEED.collector3, { typeClass: 'sealed_case' }));
    }
    const broke = await signIn(SEED.collector3);
    const au = await addressFor(broke, {
      label: 'Sydney',
      recipient: 'Ana Maria van der Berg',
      line1: '1 George St',
      city: 'Sydney',
      country: 'AU',
      postalCode: '2000',
    });

    const before = (await broke.get('/finance/wallet')).body;
    expect(before.amount).toBeGreaterThanOrEqual(0);

    const s = (
      await broke.post('/shipping/shipments', {
        itemIds: cases.map((c) => c.id),
        addressId: au,
        declaredValueMinor: 400_000,
        insuredValueMinor: 500_000,
        signatureRequired: true,
      })
    ).body;

    const rates = (await broke.get(`/shipping/shipments/${s.id}/rates`)).body as Array<{
      carrier: string;
      serviceLevel: string;
      eligible: boolean;
      totalMinor: number;
    }>;
    const pick = rates.filter((r) => r.eligible).sort((a, b) => b.totalMinor - a.totalMinor)[0]!;
    expect(pick.totalMinor).toBeGreaterThan(before.amount);

    const selected = await broke.post(`/shipping/shipments/${s.id}/select-rate`, {
      carrier: pick.carrier,
      serviceLevel: pick.serviceLevel,
    });
    // Held, not charged. The old behaviour drove the wallet negative, which
    // blocked every other service the collector had.
    expect(selected.body.status).toBe('awaiting_payment');
    expect(selected.body.shortfallMinor).toBe(pick.totalMinor - before.amount);
    expect(selected.body.paymentDueAt).toBeTruthy();

    // Paying while still short is refused rather than half-done.
    const early = await broke.post(`/shipping/shipments/${s.id}/pay`);
    expect(early.status).toBe(409);

    // Exactly the shortfall, so the wallet ends where it started: at zero.
    await fundWallet(SEED.collector3, selected.body.shortfallMinor as number);
    const paid = await broke.post(`/shipping/shipments/${s.id}/pay`);
    expect(paid.status).toBe(201);
    expect(paid.body.status).toBe('rates_selected');
    // The price was frozen when the service was chosen, not re-quoted on
    // payment day (Principle V).
    expect(paid.body.paid).toBe(pick.totalMinor);

    const after = (await broke.get('/finance/wallet')).body;
    expect(after.amount).toBe(0);
  });

  /* ---------------- customs ---------------- */

  it('produces a commercial invoice whose lines add up to the declared value', async () => {
    const { item: a } = await itemFor();
    const { item: b } = await itemFor();
    const collector = await signIn(SEED.collector);
    const jp = await addressFor(collector, JP);

    const s = (
      await collector.post('/shipping/shipments', {
        itemIds: [a.id, b.id],
        addressId: jp,
        declaredValueMinor: 12_345,
      })
    ).body;

    const invoice = (await collector.get(`/shipping/shipments/${s.id}/customs`)).body;
    expect(invoice.lines).toHaveLength(2);
    // The apportionment must not lose a cent — the last line absorbs rounding.
    expect(invoice.totals.valueMinor).toBe(12_345);
    for (const line of invoice.lines) {
      expect(line.hsCode).toBeTruthy();
      expect(line.countryOfOrigin).toBeTruthy();
    }
    expect(invoice.declaration).toMatch(/does not adjust/i);
  });

  it('has no customs declaration for a domestic parcel', async () => {
    const { item } = await itemFor();
    const collector = await signIn(SEED.collector);
    const us = await addressFor(collector, US);
    const s = (await collector.post('/shipping/shipments', { itemIds: [item.id], addressId: us })).body;
    const res = await collector.get(`/shipping/shipments/${s.id}/customs`);
    expect(res.status).toBe(400);
  });

  /* ---------------- shared parcels ---------------- */

  it('lets two collectors ship to one address without either owning the other cards', async () => {
    const operator = await signIn(SEED.operator);
    const mine = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const theirs = await intakeFor(operator, SEED.collector2, { typeClass: 'trading_card' });

    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);

    const shared = {
      label: 'Convention hotel',
      recipient: 'Front desk — Bault group',
      line1: '400 Boardwalk',
      city: 'Atlantic City',
      country: 'US',
      postalCode: '08401',
    };
    const redAddr = await addressFor(red, shared);
    const goldenAddr = await addressFor(golden, shared);

    const redShip = (await red.post('/shipping/shipments', { itemIds: [mine.id], addressId: redAddr })).body;
    const goldenShip = (
      await golden.post('/shipping/shipments', { itemIds: [theirs.id], addressId: goldenAddr })
    ).body;

    const group = (await red.post('/shipping/groups', { shipmentId: redShip.id, notes: 'Table 42' })).body;
    expect(group.code).toMatch(/^GRP-/);

    const joined = await golden.post('/shipping/groups/join', {
      groupCode: group.code,
      shipmentId: goldenShip.id,
    });
    expect(joined.status).toBe(201);
    expect(joined.body.memberCount).toBe(2);

    // Each collector still owns exactly their own cards — the group carries no
    // items at all, which is the whole reason it is a separate thing.
    const described = (await red.get(`/shipping/groups/${group.id}`)).body;
    const payer = described.members.find((m: { isPayer: boolean }) => m.isPayer);
    expect(payer.shipmentId).toBe(redShip.id);
    expect(described.totalItems).toBe(2);

    // Only the payer may close it.
    const wrongHand = await golden.post(`/shipping/groups/${group.id}/lock`);
    expect(wrongHand.status).toBe(403);

    const locked = await red.post(`/shipping/groups/${group.id}/lock`);
    expect(locked.status).toBe(201);
    expect(locked.body.memberCount).toBe(2);
  });

  it('refuses to join a shared parcel going somewhere else', async () => {
    const operator = await signIn(SEED.operator);
    const mine = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const theirs = await intakeFor(operator, SEED.collector2, { typeClass: 'trading_card' });

    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const redAddr = await addressFor(red, { ...US, label: 'Group A' });
    const goldenAddr = await addressFor(golden, {
      label: 'Elsewhere',
      recipient: 'Golden Marsh',
      line1: '9 Other Rd',
      city: 'Newark',
      country: 'US',
      postalCode: '07102',
    });

    const redShip = (await red.post('/shipping/shipments', { itemIds: [mine.id], addressId: redAddr })).body;
    const goldenShip = (
      await golden.post('/shipping/shipments', { itemIds: [theirs.id], addressId: goldenAddr })
    ).body;

    const group = (await red.post('/shipping/groups', { shipmentId: redShip.id })).body;
    const joined = await golden.post('/shipping/groups/join', {
      groupCode: group.code,
      shipmentId: goldenShip.id,
    });
    expect(joined.status).toBe(400);
  });

  /* ---------------- direct from the tax-free site ---------------- */

  it('publishes the direct-overnight terms', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/shipping/direct/terms');
    expect(res.status).toBe(200);
    expect(res.body.flatCostMinor).toBeGreaterThan(0);
    expect(res.body.maxItems).toBeGreaterThan(0);
    expect(res.body.country).toBe('US');
  });

  it('ships a parcel straight out of the tax-free site without it entering the vault', async () => {
    const collector = await signIn(SEED.collector);
    const operator = await signIn(SEED.operator);
    const us = await addressFor(collector, US);
    await fundWallet(SEED.collector, 30_000);

    // Registered against the DELAWARE forwarding site — the one the overnight
    // service leaves from.
    const registered = await collector.post('/me/parcels', {
      facilityCode: 'DE',
      carrier: 'UPS',
      trackingNumber: `DIRECT-${Date.now()}`,
      declaredContents: 'Two slabs from a Whatnot break',
    });
    expect(registered.status).toBe(201);
    const parcelId = registered.body.id as string;

    // Not eligible until it physically arrives.
    const early = (await collector.get(`/shipping/direct/${parcelId}/eligibility`)).body;
    expect(early.eligible).toBe(false);

    const received = await operator.post('/parcels/receive', {
      facilityCode: 'DE',
      addressedTo: 'red',
      trackingNumber: registered.body.trackingNumber,
    });
    expect(received.status).toBe(201);

    const now = (await collector.get(`/shipping/direct/${parcelId}/eligibility`)).body;
    expect(now.eligible).toBe(true);

    // More cards than the envelope carries.
    const tooMany = await collector.post(`/shipping/direct/${parcelId}`, {
      addressId: us,
      cardCount: 9,
    });
    expect(tooMany.status).toBe(400);

    const shipped = await collector.post(`/shipping/direct/${parcelId}`, {
      addressId: us,
      cardCount: 2,
      insuredValueMinor: 40_000,
    });
    expect(shipped.status).toBe(201);
    expect(shipped.body.shipmentCode).toMatch(/^SHP-/);
    // $100 flat plus the insurance premium, and nothing else — no intake, no
    // storage, no forwarding fee, because it never entered the vault.
    expect(shipped.body.costMinor).toBeGreaterThanOrEqual(10_000);

    // The parcel is answered for and cannot be sent twice.
    const again = await collector.post(`/shipping/direct/${parcelId}`, { addressId: us, cardCount: 1 });
    expect(again.status).toBe(409);

    // And nothing was booked into the vault off the back of it.
    const shipment = (await collector.get(`/shipping/shipments/${shipped.body.shipmentId}`)).body;
    expect(shipment.itemIds).toHaveLength(0);
    expect(shipment.serviceKey).toBe('direct_overnight');
  });
});
