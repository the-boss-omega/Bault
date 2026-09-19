import type {
  LabelResult,
  Rate,
  RateRequest,
  ShipAddress,
  ShippingAdapter,
  TrackingStatus,
} from './shipping';
import { DEFAULT_PACKAGING_GRAMS } from './shipping';

/**
 * EasyPost — real carriers, real rates, real labels.
 *
 * The platform shipped with `SandboxShippingAdapter` bound unconditionally. It
 * invents prices (the file says so), `buyLabel` returns `SBX<timestamp>` and a
 * label key that resolves to nothing, and `getTracking` answers `in_transit` for
 * every input forever. So a collector could be charged for a shipment that could
 * not physically happen, and the tracking worker polled a function that never
 * changed its mind.
 *
 * WHY EASYPOST. It rates across USPS, UPS, FedEx and DHL from one account, it
 * has a genuine test mode (keys prefixed `EZTK`) where every code path is
 * identical to live, and it is pay-per-label with no monthly minimum — which
 * matches a vault shipping tens of parcels a day rather than thousands.
 *
 * NO SDK. `@easypost/api` is a dependency for three HTTP calls against a stable,
 * documented REST API. Written directly, this adapter is auditable in one sitting
 * and adds nothing to the install.
 *
 * THE SHAPE OF THE API, and why the interface had to change. EasyPost does not
 * quote a price you can later buy by name. You create a SHIPMENT, it returns
 * RATES with ids, and you buy one of those rates against that shipment. So `Rate`
 * now carries `providerShipmentId` / `providerRateId`, and `buyLabel` purchases
 * the exact quote the collector was shown rather than re-rating at label time and
 * charging a different number.
 */

const TEST_HOST = 'https://api.easypost.com/v2';

/** Grams → ounces, which is the only weight unit EasyPost's parcel accepts. */
const gramsToOunces = (grams: number): number => Math.max(0.1, Number((grams / 28.3495).toFixed(2)));

/** Centimetres → inches, for the optional parcel dimensions. */
const cmToInches = (cm: number): number => Number((cm / 2.54).toFixed(2));

/** EasyPost quotes decimal dollars as a string; the ledger stores integer cents. */
const toMinor = (value: string): number => Math.round(Number(value) * 100);

export interface EasyPostConfig {
  /** `EZTK…` for test, `EZAK…` for production. */
  apiKey: string;
  /** Override for tests. Defaults to the public API. */
  baseUrl?: string;
}

interface EasyPostRate {
  id: string;
  carrier: string;
  service: string;
  rate: string;
  currency: string;
  delivery_days: number | null;
  est_delivery_days: number | null;
}

interface EasyPostShipment {
  id: string;
  rates?: EasyPostRate[];
  tracking_code?: string;
  postage_label?: { label_url?: string };
  selected_rate?: EasyPostRate;
  messages?: { carrier?: string; message?: string }[];
}

export class EasyPostShippingAdapter implements ShippingAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: EasyPostConfig) {
    if (!config.apiKey) throw new Error('EasyPostShippingAdapter needs an API key');
    this.baseUrl = (config.baseUrl ?? TEST_HOST).replace(/\/+$/, '');
  }

  /** Whether this account is pointed at test mode. Surfaced so the app can say so. */
  get isTestMode(): boolean {
    return this.config.apiKey.startsWith('EZTK');
  }

  /**
   * EasyPost authenticates with the API key as the HTTP Basic USERNAME and an
   * empty password — not a bearer token, which is the thing everybody gets wrong
   * first.
   */
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.config.apiKey}:`).toString('base64')}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const text = await res.text();
    if (!res.ok) {
      // EasyPost's error body names the field it rejected. Passing it through is
      // the difference between "shipping failed" and "the destination is missing
      // a street", which is the one an operator can act on.
      let detail = text.slice(0, 500);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string; errors?: unknown[] } };
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        /* keep the raw body */
      }
      throw new Error(`EasyPost ${res.status} on ${path}: ${detail}`);
    }
    return JSON.parse(text) as T;
  }

  /**
   * An address a carrier will accept.
   *
   * Refused loudly when a street is missing, rather than sent and allowed to
   * produce a quote that changes at label time. `country` and `postalCode` alone
   * are enough for the sandbox's crude distance band and are NOT enough for a
   * real rate.
   */
  private address(addr: ShipAddress | undefined, role: 'origin' | 'destination') {
    if (!addr) {
      throw new Error(
        `EasyPost needs an ${role} address. The quote was requested without one, so there is ` +
          `nothing to rate against.`,
      );
    }
    if (!addr.street1?.trim() || !addr.city?.trim()) {
      throw new Error(
        `EasyPost needs a street and city for the ${role} address (got country ` +
          `"${addr.country}", postcode "${addr.postalCode}"). A real carrier cannot rate without ` +
          `them, and a quote that skipped them would change when the label was bought.`,
      );
    }
    return {
      name: addr.name ?? undefined,
      company: addr.company ?? undefined,
      street1: addr.street1.trim(),
      street2: addr.street2?.trim() || undefined,
      city: addr.city.trim(),
      state: addr.region?.trim() || undefined,
      zip: addr.postalCode.trim(),
      country: addr.country.trim().toUpperCase(),
      phone: addr.phone?.trim() || undefined,
      email: addr.email?.trim() || undefined,
    };
  }

  /**
   * Price the parcel with every carrier the account has enabled.
   *
   * Packaging weight is added here for the same reason the sandbox added it: a
   * parcel is the cards plus the box, and quoting the contents alone
   * under-declares every shipment — which with a real carrier means a billing
   * adjustment after the fact rather than a wrong number on a screen.
   */
  async getRates(req: RateRequest): Promise<Rate[]> {
    const contentsGrams = req.items.reduce((sum, i) => sum + Math.max(0, i.weightGrams), 0);
    const packagedGrams = contentsGrams + (req.packagingGrams ?? DEFAULT_PACKAGING_GRAMS);

    const parcel: Record<string, number> = { weight: gramsToOunces(packagedGrams) };
    if (req.dimensionsCm) {
      parcel.length = cmToInches(req.dimensionsCm.length);
      parcel.width = cmToInches(req.dimensionsCm.width);
      parcel.height = cmToInches(req.dimensionsCm.height);
    }

    const shipment = await this.call<EasyPostShipment>('/shipments', {
      method: 'POST',
      body: JSON.stringify({
        shipment: {
          to_address: this.address(req.destination, 'destination'),
          from_address: this.address(req.origin, 'origin'),
          parcel,
          options: {
            // The carrier collects a signature. Priced by the carrier, so it
            // must be set at RATE time, not at purchase — set it later and the
            // price the collector was shown is not the price that is charged.
            ...(req.signatureRequired ? { delivery_confirmation: 'SIGNATURE' } : {}),
          },
        },
      }),
    });

    const wanted = req.services;
    return (shipment.rates ?? [])
      .filter(
        (r) =>
          !wanted ||
          wanted.some(
            (w) =>
              w.carrier.toLowerCase() === r.carrier.toLowerCase() &&
              w.serviceLevel.toLowerCase() === r.service.toLowerCase(),
          ),
      )
      .map((r) => ({
        carrier: r.carrier,
        serviceLevel: r.service,
        costMinor: toMinor(r.rate),
        currency: r.currency,
        // `delivery_days` is the carrier's promise and is often null on
        // economy services; `est_delivery_days` is EasyPost's estimate. Zero
        // rather than a guess when neither is given — the caller renders "—".
        estimatedDays: r.delivery_days ?? r.est_delivery_days ?? 0,
        providerShipmentId: shipment.id,
        providerRateId: r.id,
      }))
      .sort((a, b) => a.costMinor - b.costMinor);
  }

  /**
   * Buy the exact rate that was quoted.
   *
   * This is the step that spends money, so it refuses to improvise: without the
   * provider's own ids it throws rather than re-rating, because re-rating would
   * charge a price nobody was shown and would silently succeed while doing it.
   */
  async buyLabel(rate: Rate, _req: RateRequest): Promise<LabelResult> {
    if (!rate.providerShipmentId || !rate.providerRateId) {
      throw new Error(
        'This rate did not come from EasyPost, so there is nothing to buy. A label can only be ' +
          'purchased against the shipment and rate the carrier quoted.',
      );
    }

    const bought = await this.call<EasyPostShipment>(
      `/shipments/${encodeURIComponent(rate.providerShipmentId)}/buy`,
      { method: 'POST', body: JSON.stringify({ rate: { id: rate.providerRateId } }) },
    );

    if (!bought.tracking_code) {
      throw new Error(
        `EasyPost accepted the purchase but returned no tracking code for shipment ` +
          `${rate.providerShipmentId}. The label may have been bought — check the dashboard ` +
          `before retrying, or you will pay twice.`,
      );
    }

    return {
      trackingNumber: bought.tracking_code,
      // The carrier's own hosted label URL. It is stored as the object key so
      // the existing label pipeline keeps working unchanged; mirroring the PDF
      // into Bault's own bucket is the obvious next step and is not this change.
      labelObjectKey: bought.postage_label?.label_url ?? '',
      costMinor: bought.selected_rate ? toMinor(bought.selected_rate.rate) : rate.costMinor,
      currency: bought.selected_rate?.currency ?? rate.currency,
    };
  }

  /**
   * Where the parcel is, according to the carrier.
   *
   * EasyPost's statuses are mapped down to the four this platform models. An
   * unrecognised status becomes `unknown` rather than being guessed into
   * `in_transit` — a parcel whose state nobody can read is not a parcel in
   * transit, and pretending otherwise is how a lost shipment stays "on its way"
   * for three weeks.
   */
  async getTracking(trackingNumber: string): Promise<TrackingStatus> {
    const tracker = await this.call<{ status?: string }>('/trackers', {
      method: 'POST',
      body: JSON.stringify({ tracker: { tracking_code: trackingNumber } }),
    });

    const status = (tracker.status ?? '').toLowerCase();
    const mapped: TrackingStatus['status'] =
      status === 'delivered'
        ? 'delivered'
        : ['in_transit', 'out_for_delivery', 'pre_transit', 'available_for_pickup'].includes(status)
          ? 'in_transit'
          : ['error', 'failure', 'return_to_sender', 'cancelled'].includes(status)
            ? 'exception'
            : 'unknown';

    return { trackingNumber, status: mapped };
  }
}
