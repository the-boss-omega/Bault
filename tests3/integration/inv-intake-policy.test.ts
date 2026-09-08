import { describe, it, expect } from 'vitest';
import { Client, SEED, signIn } from '../../tests/integration/helpers/http';

/**
 * The published intake policy, and the customs guidance that goes with it.
 *
 * Both close the same class of gap: a rule Bault already enforced that no
 * customer could read. So the tests are mostly about the two properties that
 * make a published rule trustworthy — that it is REACHABLE by the person who
 * needs it, and that it CANNOT DRIFT from the rule actually being enforced.
 */

interface AcceptedClass {
  key: string;
  label: string;
  oversized: boolean;
  lotEligible: boolean;
  lotMinSize?: number;
  typicalWeightGrams: number;
}

interface IntakePolicy {
  acceptedClasses: AcceptedClass[];
  refusedCategories: { key: string; label: string; prohibited: boolean; reason: string }[];
  outcomes: string[];
  lotThreshold: number;
  rules: { id: string; heading: string; body: string }[];
}

describe('the published intake policy', () => {
  it('is readable with no account at all', async () => {
    // The failure this page closes is somebody posting a box without knowing the
    // rule. Somebody deciding whether to use Bault has no session yet.
    const anonymous = new Client();
    const res = await anonymous.get('/content/intake-policy');
    expect(res.status).toBe(200);
    expect((res.body as IntakePolicy).acceptedClasses.length).toBeGreaterThan(0);
  });

  it('publishes exactly the classes intake accepts, and no others', async () => {
    const anonymous = new Client();
    const policy = (await anonymous.get('/content/intake-policy')).body as IntakePolicy;
    const operator = await signIn(SEED.operator);

    const published = policy.acceptedClasses.map((c) => c.key);
    expect(published.length).toBeGreaterThan(0);

    // Every published class is one intake will really take. A page listing a
    // class the validator rejects is worse than no page.
    for (const key of published) {
      const res = await operator.post('/intake/items', {
        ownerUsername: 'red',
        typeClass: key,
        autoStow: true,
      });
      expect(res.status, `intake refused published class ${key}`).toBe(201);
    }

    // …and a class that is NOT published is refused, which is the other half of
    // "the list is closed".
    const refused = await operator.post('/intake/items', {
      ownerUsername: 'red',
      typeClass: 'vintage_car',
      autoStow: true,
    });
    expect(refused.status).toBe(400);
  });

  it('gives every refusal category a published reason', async () => {
    const anonymous = new Client();
    const policy = (await anonymous.get('/content/intake-policy')).body as IntakePolicy;

    expect(policy.refusedCategories.length).toBeGreaterThan(0);
    for (const c of policy.refusedCategories) {
      expect(c.reason.length, `${c.key} has no published reason`).toBeGreaterThan(20);
      expect(c.reason).not.toContain('No published reason');
    }

    // The tracker rule is the one this page exists for — it must be there by
    // name, since a collector learns it otherwise by losing an AirTag.
    const tracker = policy.refusedCategories.find((c) => c.key === 'gps_tracker');
    expect(tracker?.prohibited).toBe(true);

    const trackerRule = policy.rules.find((r) => r.id === 'trackers');
    expect(trackerRule).toBeTruthy();
    expect(trackerRule!.body).toMatch(/destroyed/i);
  });

  it('separates a judgement about value from a refusal', async () => {
    const anonymous = new Client();
    const policy = (await anonymous.get('/content/intake-policy')).body as IntakePolicy;

    // `no_value` is not a safety refusal and must not be presented as one.
    const noValue = policy.refusedCategories.find((c) => c.key === 'no_value');
    expect(noValue?.prohibited).toBe(false);
  });

  it('states the lot threshold the intake path actually applies', async () => {
    const anonymous = new Client();
    const policy = (await anonymous.get('/content/intake-policy')).body as IntakePolicy;
    const operator = await signIn(SEED.operator);

    const threshold = policy.lotThreshold;
    expect(threshold).toBeGreaterThan(1);

    // One under the published threshold is converted into individual items,
    // exactly as the page says.
    const under = await operator.post('/intake/items', {
      ownerUsername: 'red',
      typeClass: 'trading_card',
      autoStow: true,
      isLot: true,
      lotSize: threshold - 1,
    });
    expect(under.status).toBe(201);
    expect(Array.isArray(under.body)).toBe(true);
    expect(under.body).toHaveLength(threshold - 1);

    // One at the threshold stays a single lot.
    const at = await operator.post('/intake/items', {
      ownerUsername: 'red',
      typeClass: 'trading_card',
      autoStow: true,
      isLot: true,
      lotSize: threshold,
    });
    expect(at.status).toBe(201);
    expect(at.body.isLot).toBe(true);
  });
});

describe('destination customs guidance', () => {
  it('answers for a destination with no shipment and no account', async () => {
    // Asked before you have a parcel, and often before you have an account:
    // "can Bault even ship to my country, and what will I owe at the far end".
    const anonymous = new Client();
    const res = await anonymous.get('/shipping/destinations/AU');
    expect(res.status).toBe(200);
    expect(res.body.specific.name).toBe('Australia');
    // Every destination-specific claim carries the authority that issues it.
    expect(res.body.specific.authority.url).toMatch(/^https:\/\//);
    // And it names the clearance step Bault does NOT perform — the one thing
    // the parity audit found genuinely unattempted.
    expect(res.body.specific.notHandled.join(' ')).toMatch(/assembly order/i);
  });

  it('never states a duty figure it would have had to invent', async () => {
    const collector = await signIn(SEED.collector);
    for (const country of ['AU', 'CA', 'GB', 'IL']) {
      const body = (await collector.get(`/shipping/destinations/${country}`)).body;
      const prose = [
        ...body.universal,
        ...body.specific.notes,
        ...body.specific.notHandled,
      ].join(' ');
      // No percentages and no currency thresholds: those move, and a number
      // Bault made up is a number somebody plans around.
      expect(prose, `${country} quotes a rate`).not.toMatch(/\d+\s?%/);
      expect(prose, `${country} quotes a threshold`).not.toMatch(/[$€£]\s?\d/);
    }
  });

  it('is honest about a destination it has not written up', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/shipping/destinations/JP');
    expect(res.status).toBe(200);
    // Not an error, not an invented paragraph — the universal rules, and an
    // explicit null where the specific guidance would be.
    expect(res.body.specific).toBeNull();
    expect(res.body.universal.length).toBeGreaterThan(0);
  });

  it('is case-insensitive, because a country code is typed by people', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/shipping/destinations/au');
    expect(res.body.specific.country).toBe('AU');
  });

  it('always says the declared value is the collector’s and is never adjusted', async () => {
    const collector = await signIn(SEED.collector);
    const body = (await collector.get('/shipping/destinations/GB')).body;
    expect(body.universal.join(' ')).toMatch(/never adjusts/i);
    expect(body.universal.join(' ')).toMatch(/payable by the recipient/i);
  });
});

describe('customs readiness on a real shipment', () => {
  it('warns before the parcel leaves, and links the destination authority', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);

    // Something to send, booked in without ever being weighed — which is the
    // case the estimated-weight warning exists for.
    const item = await operator.post('/intake/items', {
      ownerUsername: 'red',
      typeClass: 'graded_slab',
      description: 'For the readiness check',
      autoStow: true,
    });
    expect(item.status).toBe(201);

    const address = await collector.post('/me/addresses', {
      label: 'Sydney readiness',
      recipient: 'Ana Maria van der Berg',
      line1: '1 George St',
      city: 'Sydney',
      country: 'AU',
      postalCode: '2000',
    });
    expect(address.status).toBe(201);

    const shipment = await collector.post('/shipping/shipments', {
      itemIds: [item.body.id],
      addressId: address.body.id,
      declaredValueMinor: 25_000,
    });
    expect(shipment.status).toBe(201);

    const res = await collector.get(`/shipping/shipments/${shipment.body.id}/customs/readiness`);
    expect(res.status).toBe(200);
    expect(res.body.international).toBe(true);

    // The universal rules always travel with the answer.
    expect(res.body.guidance.universal.length).toBeGreaterThan(0);
    // …and Australia has written guidance, with its authority named.
    expect(res.body.guidance.specific.name).toBe('Australia');
    expect(res.body.guidance.specific.authority.url).toMatch(/abf\.gov\.au/);

    // Nothing was weighed, so the estimate is surfaced rather than presented as
    // a measurement — and it is a warning, not a refusal.
    const codes = (res.body.warnings as { code: string }[]).map((w) => w.code);
    expect(codes).toContain('estimated_weight');
    expect(res.body.ready).toBe(false);
  });

  it('says nothing at all about customs on a domestic parcel', async () => {
    const operator = await signIn(SEED.operator);
    const collector = await signIn(SEED.collector);

    const item = await operator.post('/intake/items', {
      ownerUsername: 'red',
      typeClass: 'trading_card',
      autoStow: true,
    });
    const address = await collector.post('/me/addresses', {
      label: 'Trenton readiness',
      recipient: 'Red Ashwood',
      line1: '12 Vine St',
      city: 'Trenton',
      country: 'US',
      postalCode: '08608',
    });
    const shipment = await collector.post('/shipping/shipments', {
      itemIds: [item.body.id],
      addressId: address.body.id,
    });
    expect(shipment.status).toBe(201);

    const res = await collector.get(`/shipping/shipments/${shipment.body.id}/customs/readiness`);
    expect(res.status).toBe(200);
    expect(res.body.international).toBe(false);
    // No border, no guidance — rather than a page of rules that do not apply.
    expect(res.body.guidance.universal).toEqual([]);
    expect(res.body.guidance.specific).toBeNull();
  });
});
