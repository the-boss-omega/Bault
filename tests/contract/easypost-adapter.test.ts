import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EasyPostShippingAdapter,
  LabelNotPurchasedError,
  SandboxShippingAdapter,
  type CustomsDeclaration,
} from '@bault/adapters';

const ORIGIN = {
  name: 'Bault New Jersey',
  street1: '12 Ferry Street',
  city: 'Newark',
  region: 'NJ',
  postalCode: '07105',
  country: 'US',
};

const DESTINATION = {
  name: 'Red Ashwood',
  street1: '1140 W Addison St',
  city: 'Chicago',
  region: 'IL',
  postalCode: '60613',
  country: 'US',
};

const SHIPMENT_RESPONSE = {
  id: 'shp_abc123',
  rates: [
    {
      id: 'rate_fast',
      carrier: 'FedEx',
      service: 'FEDEX_2_DAY',
      rate: '18.55',
      currency: 'USD',
      delivery_days: 2,
      est_delivery_days: 2,
    },
    {
      id: 'rate_cheap',
      carrier: 'USPS',
      service: 'GroundAdvantage',
      rate: '5.41',
      currency: 'USD',
      delivery_days: null,
      est_delivery_days: 4,
    },
  ],
};

let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(responder: (url: string) => unknown, status = 200) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const body = responder(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'stub',
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

const adapter = () => new EasyPostShippingAdapter({ apiKey: 'EZTK_test_key' });

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the EasyPost adapter', () => {
  it('authenticates with the key as the Basic username, not a bearer token', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    await adapter().getRates({
      destination: DESTINATION,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }],
      rush: false,
    });

    const auth = (calls[0]!.init.headers as Record<string, string>).authorization;
    expect(auth).toMatch(/^Basic /);
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    expect(decoded).toBe('EZTK_test_key:');
  });

  it('quotes in integer cents, sorted cheapest first, carrying the provider ids', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    const rates = await adapter().getRates({
      destination: DESTINATION,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }],
      rush: false,
    });

    expect(rates.map((r) => r.costMinor)).toEqual([541, 1855]);
    expect(rates[0]).toMatchObject({
      carrier: 'USPS',
      serviceLevel: 'GroundAdvantage',
      currency: 'USD',
      estimatedDays: 4,
      providerShipmentId: 'shp_abc123',
      providerRateId: 'rate_cheap',
    });
  });

  it('adds packaging weight and sends ounces, not grams', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    await adapter().getRates({
      destination: DESTINATION,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }, { weightGrams: 60 }],
      rush: false,
    });

    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.shipment.parcel.weight).toBeCloseTo(8.47, 1);
  });

  it('sends the chosen box: its dimensions in inches and its own weight', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    await adapter().getRates({
      destination: DESTINATION,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }],
      rush: false,
      dimensionsCm: { length: 33, width: 25, height: 15 },
      packagingGrams: 320,
    });

    const parcel = JSON.parse(String(calls[0]!.init.body)).shipment.parcel;
    expect(parcel.length).toBeCloseTo(13, 0);
    expect(parcel.width).toBeCloseTo(9.8, 0);
    expect(parcel.height).toBeCloseTo(5.9, 0);
    expect(parcel.weight).toBeCloseTo(13.4, 1);
  });

  it('sends each address’s state or province as the state the carrier reads', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    await adapter().getRates({
      destination: DESTINATION,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }],
      rush: false,
    });

    const sent = JSON.parse(String(calls[0]!.init.body)).shipment;
    expect(sent.to_address.state).toBe('IL');
    expect(sent.from_address.state).toBe('NJ');
  });

  it('asks for the signature at RATE time, so the quoted price is the charged price', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    await adapter().getRates({
      destination: DESTINATION,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }],
      rush: false,
      signatureRequired: true,
    });

    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.shipment.options.delivery_confirmation).toBe('SIGNATURE');
  });

  it('buys the exact rate that was quoted', async () => {
    stubFetch((url) =>
      url.includes('/buy')
        ? {
            id: 'shp_abc123',
            tracking_code: '9400100000000000000042',
            postage_label: { label_url: 'https://easypost-files.test/label.pdf' },
            selected_rate: { ...SHIPMENT_RESPONSE.rates[1], rate: '5.41' },
          }
        : SHIPMENT_RESPONSE,
    );

    const a = adapter();
    const req = {
      destination: DESTINATION,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }],
      rush: false,
    };
    const rates = await a.getRates(req);
    const label = await a.buyLabel(rates[0]!, req);

    const buy = calls.find((c) => c.url.includes('/buy'))!;
    expect(buy.url).toContain('/shipments/shp_abc123/buy');
    expect(JSON.parse(String(buy.init.body))).toEqual({ rate: { id: 'rate_cheap' } });
    expect(label.trackingNumber).toBe('9400100000000000000042');
    expect(label.costMinor).toBe(541);
  });

  it('refuses to buy a rate it did not quote, rather than re-rating', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    const req = {
      destination: DESTINATION,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }],
      rush: false,
    };
    await expect(
      adapter().buyLabel(
        { carrier: 'USPS', serviceLevel: 'GroundAdvantage', costMinor: 541, currency: 'USD', estimatedDays: 4 },
        req,
      ),
    ).rejects.toThrow(/only be purchased against the shipment and rate the carrier quoted/i);
  });

  it('refuses an address a carrier cannot rate, naming what is missing', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    await expect(
      adapter().getRates({
        destination: { country: 'US', postalCode: '60613' },
        origin: ORIGIN,
        items: [{ weightGrams: 60 }],
        rush: false,
      }),
    ).rejects.toThrow(/needs a street and city for the destination address/i);

    await expect(
      adapter().getRates({
        destination: DESTINATION,
        origin: undefined,
        items: [{ weightGrams: 60 }],
        rush: false,
      }),
    ).rejects.toThrow(/needs an origin address/i);
  });

  it('passes the carrier error through instead of saying "shipping failed"', async () => {
    stubFetch(() => ({ error: { message: 'to_address.zip is invalid for US' } }), 422);
    await expect(
      adapter().getRates({
        destination: DESTINATION,
        origin: ORIGIN,
        items: [{ weightGrams: 60 }],
        rush: false,
      }),
    ).rejects.toThrow(/to_address\.zip is invalid for US/);
  });

  it('maps an unreadable tracking status to unknown, never to in_transit', async () => {
    stubFetch(() => ({ status: 'some_status_easypost_added_last_week' }));
    const t = await adapter().getTracking('9400100000000000000042');
    expect(t.status).toBe('unknown');

    stubFetch(() => ({ status: 'delivered' }));
    expect((await adapter().getTracking('x')).status).toBe('delivered');

    stubFetch(() => ({ status: 'return_to_sender' }));
    expect((await adapter().getTracking('x')).status).toBe('exception');
  });

  const TOKYO = { name: 'Red Ashwood', street1: '1-1 Chiyoda', city: 'Tokyo', postalCode: '100-0001', country: 'JP' };
  const TORONTO = { name: 'Red Ashwood', street1: '100 Queen St W', city: 'Toronto', region: 'ON', postalCode: 'M5H 2N2', country: 'CA' };
  const declaration = (valueMinor: number): CustomsDeclaration => ({
    contentsType: 'merchandise',
    signer: 'Bault New Jersey',
    nonDelivery: 'return',
    currency: 'USD',
    lines: [
      { description: 'Rayquaza ex #97/97', quantity: 1, valueMinor, weightGrams: 60, hsCode: '4911.99', originCountry: 'US' },
    ],
  });

  it('refuses to rate an international parcel that carries no customs declaration', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    await expect(
      adapter().getRates({ destination: TOKYO, origin: ORIGIN, items: [{ weightGrams: 60 }], rush: false }),
    ).rejects.toThrow(/needs a customs declaration/i);
    expect(calls).toHaveLength(0);
  });

  it('cites the low-value EEI exemption, and the Canadian one for Canada', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    await adapter().getRates({
      destination: TOKYO,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }],
      rush: false,
      customs: declaration(400_00),
    });
    await adapter().getRates({
      destination: TORONTO,
      origin: ORIGIN,
      items: [{ weightGrams: 60 }],
      rush: false,
      customs: declaration(400_00),
    });
    const eel = calls.map((c) => JSON.parse(String(c.init.body)).shipment.customs_info.eel_pfc);
    expect(eel).toEqual(['NOEEI 30.37(a)', 'NOEEI 30.36']);
  });

  it('refuses a declaration that needs an AES filing, rather than claiming an exemption', async () => {
    stubFetch(() => SHIPMENT_RESPONSE);
    await expect(
      adapter().getRates({
        destination: TOKYO,
        origin: ORIGIN,
        items: [{ weightGrams: 60 }],
        rush: false,
        customs: declaration(3_000_00),
      }),
    ).rejects.toThrow(/EEI filing in AES/);
  });

  const BOUGHT = {
    id: 'shp_abc123',
    tracking_code: '9400100000000000000042',
    postage_label: { label_url: 'https://easypost-files.test/label.pdf' },
    selected_rate: { ...SHIPMENT_RESPONSE.rates[1], rate: '5.41' },
  };
  const QUOTED_RATE = {
    carrier: 'USPS',
    serviceLevel: 'GroundAdvantage',
    costMinor: 541,
    currency: 'USD',
    estimatedDays: 4,
    providerShipmentId: 'shp_abc123',
    providerRateId: 'rate_cheap',
  };
  const REQ = { destination: DESTINATION, origin: ORIGIN, items: [{ weightGrams: 60 }], rush: false };

  it('does not buy a second label for a shipment that already has one', async () => {
    stubFetch(() => BOUGHT);
    const label = await adapter().buyLabel(QUOTED_RATE, REQ, { idempotencyKey: 'ship-1' });
    expect(label.trackingNumber).toBe('9400100000000000000042');
    expect(calls.some((c) => c.url.includes('/buy'))).toBe(false);
  });

  it('reports a refused purchase as nothing bought, and an outage as unknown', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      n += 1;
      const refused = String(url).endsWith('/buy');
      return {
        ok: !refused,
        status: refused ? 422 : 200,
        statusText: 'stub',
        text: async () => JSON.stringify(refused ? { error: { message: 'rate expired' } } : SHIPMENT_RESPONSE),
      } as unknown as Response;
    });
    await expect(adapter().buyLabel(QUOTED_RATE, REQ)).rejects.toBeInstanceOf(LabelNotPurchasedError);
    expect(n).toBe(2);

    vi.stubGlobal('fetch', async (url: string) => {
      const down = String(url).endsWith('/buy');
      return {
        ok: !down,
        status: down ? 503 : 200,
        statusText: 'stub',
        text: async () => JSON.stringify(down ? { error: { message: 'upstream timeout' } } : SHIPMENT_RESPONSE),
      } as unknown as Response;
    });
    const outage = await adapter().buyLabel(QUOTED_RATE, REQ).catch((e: unknown) => e);
    expect(outage).toBeInstanceOf(Error);
    expect(outage).not.toBeInstanceOf(LabelNotPurchasedError);
  });

  it('bounds every call, with the caller’s signal when it gives one', async () => {
    stubFetch((url) => (url.endsWith('/buy') ? BOUGHT : SHIPMENT_RESPONSE));
    const signal = AbortSignal.timeout(5_000);
    await adapter().buyLabel(QUOTED_RATE, REQ, { signal });
    expect(calls.every((c) => c.init.signal === signal)).toBe(true);

    calls = [];
    await adapter().getTracking('9400100000000000000042');
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a key-less adapter at construction', () => {
    expect(() => new EasyPostShippingAdapter({ apiKey: '' })).toThrow(/API key/i);
  });

  it('knows whether it is pointed at test mode', () => {
    expect(new EasyPostShippingAdapter({ apiKey: 'EZTK_x' }).isTestMode).toBe(true);
    expect(new EasyPostShippingAdapter({ apiKey: 'EZAK_x' }).isTestMode).toBe(false);
  });
});

describe('the sandbox shipping adapter', () => {
  it('sells a label that cannot be printed', async () => {
    const label = await new SandboxShippingAdapter().buyLabel(
      { carrier: 'USPS', serviceLevel: 'Ground Advantage', costMinor: 550, currency: 'USD', estimatedDays: 4 },
      { destination: DESTINATION, items: [{ weightGrams: 60 }], rush: false },
    );
    expect(label.trackingNumber).toMatch(/^SBX/);
    expect(label.labelObjectKey).toContain('sbx-');
  });

  it('sells one label per idempotency key, so a retried dispatch gets the same one', async () => {
    const sandbox = new SandboxShippingAdapter();
    const rate = { carrier: 'USPS', serviceLevel: 'Ground Advantage', costMinor: 550, currency: 'USD', estimatedDays: 4 };
    const req = { destination: DESTINATION, items: [{ weightGrams: 60 }], rush: false };
    const first = await sandbox.buyLabel(rate, req, { idempotencyKey: '7c1e3a52-0000-4000-8000-00000000abcd' });
    const again = await sandbox.buyLabel(rate, req, { idempotencyKey: '7c1e3a52-0000-4000-8000-00000000abcd' });
    const other = await sandbox.buyLabel(rate, req, { idempotencyKey: '7c1e3a52-0000-4000-8000-00000000ffff' });
    expect(again.trackingNumber).toBe(first.trackingNumber);
    expect(other.trackingNumber).not.toBe(first.trackingNumber);
  });

  it('reports every parcel as in transit, forever', async () => {
    const sandbox = new SandboxShippingAdapter();
    expect((await sandbox.getTracking('anything')).status).toBe('in_transit');
    expect((await sandbox.getTracking('delivered-months-ago')).status).toBe('in_transit');
  });
});
