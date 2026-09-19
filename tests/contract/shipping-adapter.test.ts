import { describe, it, expect } from 'vitest';
import { SandboxShippingAdapter } from '@bault/adapters';

/**
 * Shipping adapter contract (T102, Principle XIII). Asserts the adapter honors its
 * interface for rates, labels, and tracking. A real ShipStation/Easyship adapter
 * must pass this same suite, guaranteeing swappability.
 *
 * What this suite asserts changed with the outbound-shipping pass, because what
 * the adapter is RESPONSIBLE for changed. It used to be handed a `rush` flag and
 * doubled its own base rate — which told the collector that FedEx would arrive
 * sooner because Bault packed faster. Rush is now a Bault handling charge and
 * the carrier's promise is left alone; the assertion that rush costs more moved
 * to the shipment quote, where it is now true of the price somebody actually
 * pays (`tests/integration/shp-outbound.test.ts`).
 *
 * What an adapter genuinely owes is below: a price that moves with the weight
 * and the destination, and a signature surcharge where the service offers one.
 */
describe('contract: ShippingAdapter', () => {
  const adapter = new SandboxShippingAdapter();
  const domestic = {
    destination: { country: 'US', postalCode: '08608' },
    items: [{ weightGrams: 500 }],
    rush: false,
  };
  const international = {
    destination: { country: 'DE', postalCode: '10115' },
    items: [{ weightGrams: 500 }],
    rush: false,
  };

  it('returns carrier rates with cost + service level', async () => {
    const rates = await adapter.getRates(domestic);
    expect(rates.length).toBeGreaterThan(0);
    for (const r of rates) {
      expect(r.carrier).toBeTruthy();
      expect(r.serviceLevel).toBeTruthy();
      expect(Number.isInteger(r.costMinor)).toBe(true);
      expect(r.costMinor).toBeGreaterThan(0);
      expect(r.estimatedDays).toBeGreaterThan(0);
    }
  });

  it('offers domestic and international services to the side of the border they serve', async () => {
    const home = await adapter.getRates(domestic);
    const away = await adapter.getRates({
      ...domestic,
      destination: { country: 'JP', postalCode: '100-0001' },
    });
    expect(home.length).toBeGreaterThan(0);
    expect(away.length).toBeGreaterThan(0);
    // No service quotes on both sides — the two sets are disjoint.
    const key = (r: { carrier: string; serviceLevel: string }) => `${r.carrier}/${r.serviceLevel}`;
    const homeKeys = new Set(home.map(key));
    expect(away.every((r) => !homeKeys.has(key(r)))).toBe(true);
  });

  it('charges more for a heavier parcel', async () => {
    const light = await adapter.getRates({ ...domestic, items: [{ weightGrams: 20 }] });
    const heavy = await adapter.getRates({ ...domestic, items: [{ weightGrams: 8_000 }] });
    expect(heavy[0]!.costMinor).toBeGreaterThan(light[0]!.costMinor);
  });

  it('charges more for a bigger box of the same weight', async () => {
    // A carrier sells space as well as lift: a shoebox of sleeved commons bills
    // on its volume, not on the few hundred grams it weighs.
    const mailer = await adapter.getRates({
      ...domestic,
      dimensionsCm: { length: 25, width: 18, height: 3 },
      packagingGrams: 60,
    });
    const box = await adapter.getRates({
      ...domestic,
      dimensionsCm: { length: 45, width: 35, height: 25 },
      packagingGrams: 60,
    });
    expect(box[0]!.costMinor).toBeGreaterThan(mailer[0]!.costMinor);
  });

  it('bills in whole units, because carriers do not sell fractions', async () => {
    // The reference service publishes the unit per service: "Postage amount is
    // charged per pound" for ePost, per ounce for ePacket. Two parcels inside
    // the same pound are the same parcel to a per-pound service, and quoting on
    // the continuous weight under-quotes almost every one of them.
    const lighter = await adapter.getRates({ ...international, items: [{ weightGrams: 900 }], packagingGrams: 60 });
    const heavier = await adapter.getRates({ ...international, items: [{ weightGrams: 910 }], packagingGrams: 60 });
    const ePost = (rates: Awaited<ReturnType<typeof adapter.getRates>>) =>
      rates.find((r) => r.carrier === 'ePost')!.costMinor;

    // 960 g and 970 g both land inside the same pound band.
    expect(ePost(lighter)).toBe(ePost(heavier));

    // And crossing the boundary costs a whole band more, not a few cents.
    const overBoundary = await adapter.getRates({
      ...international,
      items: [{ weightGrams: 1_400 }],
      packagingGrams: 60,
    });
    expect(ePost(overBoundary)).toBeGreaterThan(ePost(heavier));
  });

  it('weighs the box it was told about instead of the flat allowance', async () => {
    const flat = await adapter.getRates(domestic);
    const heavyBox = await adapter.getRates({ ...domestic, packagingGrams: 3_000 });
    expect(heavyBox[0]!.costMinor).toBeGreaterThan(flat[0]!.costMinor);
  });

  it('charges more for a further destination', async () => {
    const near = await adapter.getRates({
      ...domestic,
      destination: { country: 'CA', postalCode: 'M5V 2T6' },
    });
    const far = await adapter.getRates({
      ...domestic,
      destination: { country: 'AU', postalCode: '2000' },
    });
    expect(far[0]!.costMinor).toBeGreaterThan(near[0]!.costMinor);
  });

  it('charges for collecting a signature where the service offers one', async () => {
    const plain = await adapter.getRates(domestic);
    const signed = await adapter.getRates({ ...domestic, signatureRequired: true });
    expect(signed[0]!.costMinor).toBeGreaterThan(plain[0]!.costMinor);
  });

  it('quotes only the services the caller is willing to consider', async () => {
    const all = await adapter.getRates(domestic);
    const one = await adapter.getRates({
      ...domestic,
      services: [{ carrier: all[0]!.carrier, serviceLevel: all[0]!.serviceLevel }],
    });
    expect(one).toHaveLength(1);
    expect(one[0]!.carrier).toBe(all[0]!.carrier);
  });

  it('buys a label with a tracking number and returns tracking status', async () => {
    const rates = await adapter.getRates(domestic);
    const label = await adapter.buyLabel(rates[0]!, domestic);
    expect(label.trackingNumber).toBeTruthy();
    expect(label.labelObjectKey).toBeTruthy();
    const tracking = await adapter.getTracking(label.trackingNumber);
    expect(['in_transit', 'delivered', 'exception', 'unknown']).toContain(tracking.status);
  });
});
