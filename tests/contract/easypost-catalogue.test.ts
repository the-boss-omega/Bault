import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EasyPostShippingAdapter, type ShippingAdapter } from '@bault/adapters';
import { ShipmentService, type QuotedRate } from '../../apps/api/src/modules/shp/shipment.service';
import { CARRIER_SERVICES, findService, type ParcelProfile } from '../../apps/api/src/modules/shp/carriers';
import type { CustomsLine } from '../../apps/api/src/modules/shp/parcel-profile.service';

/**
 * EasyPost's rates, through the catalogue, through `ShipmentService`.
 *
 * F062 / F068. The catalogue names services for people — "Ground Advantage",
 * "Priority Mail", "2Day" — and EasyPost names them for carriers:
 * `GroundAdvantage`, `Priority`, `FEDEX_2_DAY`. Rates were paired with the
 * catalogue by comparing the two strings exactly, so with
 * `SHIPPING_PROVIDER=easypost` every rate was dropped and a collector had no way
 * to ship anything. The adapter's own contract test could not see it, because
 * the adapter was right: the pairing happens in `shipment.service.ts`, so that
 * is what this drives.
 *
 * F069. The customs lines frozen on a shipment were never sent, so an
 * international label was bought with no customs information at all.
 *
 * The fetch stub answers with EasyPost's own response shape — rate objects as
 * the API returns them, with the services a test-mode account with USPS, FedEx
 * and UPS connected actually quotes. Whether a live EZTK account returns
 * exactly these codes is what the live check is for; see the report.
 */

const NJ = {
  name: 'Bault New Jersey',
  line1: '12 Ferry Street',
  city: 'Newark',
  region: 'NJ',
  postalCode: '07105',
  country: 'US',
};

function rate(id: string, carrier: string, service: string, amount: string, days: number | null) {
  return {
    id,
    object: 'Rate',
    mode: 'test',
    service,
    carrier,
    rate: amount,
    currency: 'USD',
    retail_rate: null,
    retail_currency: null,
    list_rate: amount,
    list_currency: 'USD',
    delivery_days: days,
    delivery_date: null,
    delivery_date_guaranteed: false,
    est_delivery_days: days,
    shipment_id: 'shp_dom123',
    carrier_account_id: `ca_${carrier.toLowerCase()}`,
  };
}

/** A domestic shipment as `POST /v2/shipments` returns it. */
const DOMESTIC = {
  id: 'shp_dom123',
  object: 'Shipment',
  mode: 'test',
  messages: [{ carrier: 'DhlEcs', type: 'rate_error', message: 'not configured' }],
  rates: [
    rate('rate_usps_ga', 'USPS', 'GroundAdvantage', '6.07', 3),
    rate('rate_usps_pri', 'USPS', 'Priority', '9.85', 2),
    rate('rate_usps_exp', 'USPS', 'Express', '31.40', 1),
    rate('rate_fx_ground', 'FedEx', 'FEDEX_GROUND', '11.20', 3),
    rate('rate_fx_2day', 'FedEx', 'FEDEX_2_DAY', '24.61', 2),
    rate('rate_fx_saver', 'FedEx', 'FEDEX_EXPRESS_SAVER', '21.08', 3),
    rate('rate_fx_std_on', 'FedEx', 'STANDARD_OVERNIGHT', '48.90', 1),
    rate('rate_fx_pri_on', 'FedEx', 'PRIORITY_OVERNIGHT', '57.32', 1),
    rate('rate_ups_ground', 'UPS', 'Ground', '12.44', 3),
    rate('rate_ups_2nd', 'UPS', '2ndDayAir', '26.10', 2),
  ],
};

/** An international one, to Japan. */
const TO_JAPAN = {
  id: 'shp_jp456',
  object: 'Shipment',
  mode: 'test',
  messages: [],
  rates: [
    rate('rate_usps_fcpis', 'USPS', 'FirstClassPackageInternationalService', '18.75', null),
    rate('rate_usps_pmi', 'USPS', 'PriorityMailInternational', '62.10', 8),
    rate('rate_fx_ip', 'FedEx', 'FEDEX_INTERNATIONAL_PRIORITY', '96.40', 3),
    rate('rate_fx_ie', 'FedEx', 'INTERNATIONAL_ECONOMY', '81.15', 5),
  ],
};

let sent: Record<string, unknown>[] = [];

function stubEasyPost(response: unknown) {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
    if (init.body) sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(response) } as unknown as Response;
  });
}

/**
 * The real `ShipmentService`, with the real EasyPost adapter, and stand-ins for
 * the two things pricing reads from the database: the facility it ships from
 * and the handling fee.
 */
function service(adapter: ShippingAdapter): ShipmentService {
  const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [NJ] }) }) }) };
  const pricing = {
    price: async () => ({ amount: { amount: 300, currency: 'USD' } }),
    tryPrice: async () => null,
  };
  return new ShipmentService(
    db as never,
    adapter,
    pricing as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

const priceServices = (s: ShipmentService, profile: ParcelProfile, customs?: CustomsLine[]) =>
  (
    s as unknown as {
      priceServices(p: ParcelProfile, addOns: string[], rush: boolean, cover: null, c?: CustomsLine[]): Promise<QuotedRate[]>;
    }
  ).priceServices(profile, [], false, null, customs);

const profile = (destination: ParcelProfile['destination'], extra: Partial<ParcelProfile> = {}): ParcelProfile => ({
  destination,
  weightGrams: 60,
  itemCount: 1,
  customsValueMinor: 0,
  insuredValueMinor: 0,
  signatureRequired: false,
  originFacilityCode: null,
  ...extra,
});

const adapter = () => new EasyPostShippingAdapter({ apiKey: 'EZTK_test_key' });

beforeEach(() => {
  sent = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EasyPost rates reach the collector (F062, F068)', () => {
  it('pairs every domestic service EasyPost sells with its catalogue entry', async () => {
    stubEasyPost(DOMESTIC);
    const quoted = await priceServices(
      service(adapter()),
      profile({ country: 'US', postalCode: '60613', street1: '1140 W Addison St', city: 'Chicago', region: 'IL' }),
    );

    const byKey = new Map(quoted.map((q) => [q.serviceKey, q]));
    expect([...byKey.keys()].sort()).toEqual(['direct_overnight', 'fedex_2day', 'usps_ground', 'usps_priority']);

    // Priced at EasyPost's figure, carrying EasyPost's handles for the purchase…
    expect(byKey.get('usps_ground')).toMatchObject({ costMinor: 607, providerShipmentId: 'shp_dom123', providerRateId: 'rate_usps_ga' });
    expect(byKey.get('usps_priority')).toMatchObject({ costMinor: 985, providerRateId: 'rate_usps_pri' });
    expect(byKey.get('fedex_2day')).toMatchObject({ costMinor: 2461, providerRateId: 'rate_fx_2day' });
    // …and the overnight envelope buys next-morning when the account sells it.
    expect(byKey.get('direct_overnight')?.providerRateId).toBe('rate_fx_pri_on');

    // Named the catalogue's way, because that is what a collector selects by and
    // what the shipment stores; `findService` has to resolve every one of them.
    for (const q of quoted) {
      expect(findService(q.carrier, q.serviceLevel)?.key).toBe(q.serviceKey);
    }

    // Something is offered, and "choose for me" has something to choose.
    expect(quoted.filter((q) => q.eligible).length).toBeGreaterThan(0);
    expect(quoted.some((q) => q.recommended)).toBe(true);
  });

  it('never pairs a service by resemblance', async () => {
    // USPS Express is not Priority Mail, and FedEx Ground is not 2Day.
    stubEasyPost({
      ...DOMESTIC,
      rates: DOMESTIC.rates.filter((r) => ['Express', 'FEDEX_GROUND', 'Ground'].includes(r.service)),
    });
    const quoted = await priceServices(
      service(adapter()),
      profile({ country: 'US', postalCode: '60613', street1: '1140 W Addison St', city: 'Chicago', region: 'IL' }),
    );
    expect(quoted).toEqual([]);
  });

  it('pairs FedEx International Priority under the name the account returns, and offers no unconfirmed postal product', async () => {
    stubEasyPost(TO_JAPAN);
    const quoted = await priceServices(
      service(adapter()),
      profile(
        { country: 'JP', postalCode: '100-0001', street1: '1-1 Chiyoda', city: 'Tokyo' },
        { customsValueMinor: 20_000 },
      ),
      [
        {
          itemId: 'i1',
          serialNumber: 'SN-DR97-0001',
          description: 'Rayquaza ex #97/97, PSA 9',
          valueMinor: 20_000,
          hsCode: '4911.99',
          countryOfOrigin: 'US',
          weightGrams: 60,
          weightEstimated: false,
        },
      ],
    );
    expect(quoted.map((q) => q.serviceKey)).toEqual(['fedex_intl_priority']);
    expect(quoted[0]).toMatchObject({ carrier: 'FedEx', serviceLevel: 'International Priority', providerRateId: 'rate_fx_ip' });
    // ePacket and ePost have no confirmed EasyPost equivalent, so a USPS
    // international rate is NOT passed off as either of them.
    expect(CARRIER_SERVICES.find((s) => s.key === 'epacket')?.easypost).toBeUndefined();
  });
});

describe('the customs declaration travels with the rate request (F069)', () => {
  const LINES: CustomsLine[] = [
    {
      itemId: 'i1',
      serialNumber: 'SN-DR97-0001',
      description: '2003 Pokémon EX Dragon — Rayquaza ex #97/97',
      valueMinor: 120_00,
      hsCode: '4911.99',
      countryOfOrigin: 'US',
      weightGrams: 60,
      weightEstimated: false,
    },
    {
      itemId: 'i2',
      serialNumber: 'SN-DF97-0004',
      description: 'Rayquaza δ #97, Delta Species',
      valueMinor: 80_00,
      hsCode: '4911.99',
      countryOfOrigin: 'US',
      weightGrams: 45,
      weightEstimated: true,
    },
  ];

  it('sends the frozen customs lines for an international parcel, as customs_info', async () => {
    stubEasyPost(TO_JAPAN);
    await priceServices(
      service(adapter()),
      profile({ country: 'JP', postalCode: '100-0001', street1: '1-1 Chiyoda', city: 'Tokyo' }, { customsValueMinor: 200_00 }),
      LINES,
    );

    const shipment = sent[0]!.shipment as Record<string, unknown>;
    expect(shipment.customs_info).toEqual({
      customs_certify: true,
      customs_signer: 'Bault New Jersey',
      contents_type: 'merchandise',
      eel_pfc: 'NOEEI 30.37(a)',
      non_delivery_option: 'return',
      restriction_type: 'none',
      customs_items: [
        {
          description: '2003 Pokémon EX Dragon — Rayquaza ex #97/97',
          quantity: 1,
          value: '120.00',
          currency: 'USD',
          weight: 2.12,
          hs_tariff_number: '491199',
          origin_country: 'US',
        },
        {
          description: 'Rayquaza δ #97, Delta Species',
          quantity: 1,
          value: '80.00',
          currency: 'USD',
          weight: 1.59,
          hs_tariff_number: '491199',
          origin_country: 'US',
        },
      ],
    });
  });

  it('sends no customs for a domestic parcel', async () => {
    stubEasyPost(DOMESTIC);
    await priceServices(
      service(adapter()),
      profile({ country: 'US', postalCode: '60613', street1: '1140 W Addison St', city: 'Chicago', region: 'IL' }),
    );
    expect((sent[0]!.shipment as Record<string, unknown>).customs_info).toBeUndefined();
  });
});
