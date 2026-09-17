import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EasyPostShippingAdapter, SandboxShippingAdapter } from '@bault/adapters';

/**
 * The EasyPost adapter contract.
 *
 * Driven against a stubbed `fetch` rather than the live API, on purpose. The
 * things worth defending here are not "does EasyPost work" — that is EasyPost's
 * problem — but the four places THIS adapter can quietly do the wrong thing with
 * somebody's money:
 *
 *   1. authenticate the way EasyPost actually expects (Basic, key as USERNAME,
 *      empty password — not a bearer token);
 *   2. convert units, because the ledger is in cents and EasyPost quotes decimal
 *      dollar strings, and parcels are grams here and ounces there;
 *   3. buy THE RATE THAT WAS QUOTED, never re-rate at label time;
 *   4. refuse an address a carrier cannot rate, instead of quoting a number that
 *      would change when the label was bought.
 *
 * A live-API suite is the right companion to this and needs an EZTK key in the
 * environment; this one runs everywhere, including CI with no account.
 */

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
    // "EZTK_test_key:" — the trailing colon is the empty password, and leaving
    // it off is the mistake that makes every call 401.
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
      // delivery_days was null; est_delivery_days stands in.
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
    // 120g of contents + 120g of box = 240g = 8.47oz. Quoting the contents alone
    // under-declares every shipment, which with a real carrier is a billing
    // adjustment after the fact rather than a wrong number on a screen.
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
    // 60g of contents + 320g of box = 380g = 13.4oz — the box replaces the flat
    // 120g allowance rather than being added to it.
    expect(parcel.weight).toBeCloseTo(13.4, 1);
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
    // A rate from somewhere else — the sandbox, a cache, a hand-built object.
    // Re-rating here would charge a price nobody was shown, and would succeed.
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
        // Country and postcode only — enough for the sandbox's distance band,
        // not enough for a real quote.
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
    // A parcel whose state nobody can read is not a parcel in transit, and
    // pretending otherwise is how a lost shipment stays "on its way" for weeks.
    expect(t.status).toBe('unknown');

    stubFetch(() => ({ status: 'delivered' }));
    expect((await adapter().getTracking('x')).status).toBe('delivered');

    stubFetch(() => ({ status: 'return_to_sender' }));
    expect((await adapter().getTracking('x')).status).toBe('exception');
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
  /**
   * Stated as a fact rather than a complaint: it is a fine development stand-in
   * AND it cannot post a parcel. Both halves matter — the second is why the env
   * schema and `AdaptersModule` refuse it in production.
   */
  it('sells a label that cannot be printed', async () => {
    const label = await new SandboxShippingAdapter().buyLabel(
      { carrier: 'USPS', serviceLevel: 'Ground Advantage', costMinor: 550, currency: 'USD', estimatedDays: 4 },
      { destination: DESTINATION, items: [{ weightGrams: 60 }], rush: false },
    );
    expect(label.trackingNumber).toMatch(/^SBX/);
    expect(label.labelObjectKey).toContain('sbx-');
  });

  it('reports every parcel as in transit, forever', async () => {
    const sandbox = new SandboxShippingAdapter();
    expect((await sandbox.getTracking('anything')).status).toBe('in_transit');
    expect((await sandbox.getTracking('delivered-months-ago')).status).toBe('in_transit');
  });
});
