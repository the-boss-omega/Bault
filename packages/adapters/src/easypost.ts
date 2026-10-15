import type {
  CustomsDeclaration,
  LabelResult,
  Rate,
  RateRequest,
  ShipAddress,
  ShippingAdapter,
  ShippingCallOptions,
  TrackingStatus,
} from './shipping';
import { DEFAULT_PACKAGING_GRAMS, LabelNotPurchasedError } from './shipping';

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

/** Cents → the decimal dollar string EasyPost takes for a customs value. */
const toDecimal = (minor: number): string => (minor / 100).toFixed(2);

/**
 * How long one call may take when the caller set no bound of its own.
 *
 * `fetch` has no timeout, so a carrier that accepted the connection and never
 * answered held the request — and whatever the caller was holding — forever.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The most a single Schedule B line may be worth before US export rules require
 * an EEI filing in AES, and therefore an ITN on the label (15 CFR 30.37(a)).
 */
const EEI_THRESHOLD_MINOR = 2_500_00;

/** The exemption citation for a parcel to Canada, which needs no EEI (15 CFR 30.36). */
const EEL_PFC_CANADA = 'NOEEI 30.36';
/** The exemption citation for a low-value export anywhere else (15 CFR 30.37(a)). */
const EEL_PFC_LOW_VALUE = 'NOEEI 30.37(a)';

/** An HTTP error from EasyPost, carrying the status so a caller can tell a refusal from an outage. */
export class EasyPostError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EasyPostError';
  }
}

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
  tracking_code?: string | null;
  postage_label?: { label_url?: string } | null;
  selected_rate?: EasyPostRate | null;
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
      // Bounded always. The caller's signal when it has one — dispatch sets its
      // own for a purchase — and a default otherwise, so no call can hang.
      signal: init.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
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
      throw new EasyPostError(`EasyPost ${res.status} on ${path}: ${detail}`, res.status);
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
   * The customs declaration as EasyPost's `customs_info` object.
   *
   * The shipment froze per-item customs lines at creation and they were never
   * sent: an international parcel was rated and bought with no customs
   * information at all, which a carrier refuses or holds at the border. So an
   * international request without a declaration is refused here, loudly, the
   * same way a missing street is — and a domestic one sends nothing.
   *
   * The EEL/PFC is the US export filing citation every international label
   * carries. A parcel to Canada is exempt from EEI (`NOEEI 30.36`); elsewhere a
   * parcel is exempt while no Schedule B line is worth more than $2,500
   * (`NOEEI 30.37(a)`). Above that an EEI must be filed in AES and its ITN put
   * on the label — Bault files none, so such a parcel is refused rather than
   * labelled with an exemption it does not have.
   */
  private customsInfo(
    customs: CustomsDeclaration | undefined,
    originCountry: string,
    destinationCountry: string,
  ): Record<string, unknown> | undefined {
    if (originCountry === destinationCountry) return undefined;
    if (!customs || customs.lines.length === 0) {
      throw new Error(
        `EasyPost needs a customs declaration for a parcel from ${originCountry} to ${destinationCountry}. ` +
          `Rating it without one would buy a label the carrier refuses, or that is held at the border.`,
      );
    }
    if (!customs.signer.trim()) {
      throw new Error('EasyPost needs somebody to certify the customs declaration.');
    }

    const perHsCode = new Map<string, number>();
    for (const line of customs.lines) {
      const hs = line.hsCode.replace(/\D/g, '');
      perHsCode.set(hs, (perHsCode.get(hs) ?? 0) + line.valueMinor);
    }
    const largest = Math.max(...perHsCode.values());
    if (destinationCountry !== 'CA' && largest > EEI_THRESHOLD_MINOR) {
      throw new Error(
        `This parcel declares $${toDecimal(largest)} under one tariff number, above the $2,500.00 at which ` +
          `US export rules require an EEI filing in AES. A label needs that filing's ITN, and none exists.`,
      );
    }

    return {
      customs_certify: true,
      customs_signer: customs.signer.trim(),
      contents_type: customs.contentsType,
      ...(customs.contentsExplanation ? { contents_explanation: customs.contentsExplanation } : {}),
      eel_pfc: destinationCountry === 'CA' ? EEL_PFC_CANADA : EEL_PFC_LOW_VALUE,
      non_delivery_option: customs.nonDelivery,
      restriction_type: 'none',
      customs_items: customs.lines.map((line) => ({
        description: line.description.trim().slice(0, 100),
        quantity: line.quantity,
        // EasyPost's `value` is the whole line's value, in dollars.
        value: toDecimal(line.valueMinor),
        currency: customs.currency,
        weight: gramsToOunces(line.weightGrams),
        hs_tariff_number: line.hsCode.replace(/\D/g, ''),
        origin_country: line.originCountry.toUpperCase(),
      })),
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
  async getRates(req: RateRequest, opts: ShippingCallOptions = {}): Promise<Rate[]> {
    const contentsGrams = req.items.reduce((sum, i) => sum + Math.max(0, i.weightGrams), 0);
    const packagedGrams = contentsGrams + (req.packagingGrams ?? DEFAULT_PACKAGING_GRAMS);

    const parcel: Record<string, number> = { weight: gramsToOunces(packagedGrams) };
    if (req.dimensionsCm) {
      parcel.length = cmToInches(req.dimensionsCm.length);
      parcel.width = cmToInches(req.dimensionsCm.width);
      parcel.height = cmToInches(req.dimensionsCm.height);
    }

    const to = this.address(req.destination, 'destination');
    const from = this.address(req.origin, 'origin');
    const customs = this.customsInfo(req.customs, from.country, to.country);

    const shipment = await this.call<EasyPostShipment>('/shipments', {
      method: 'POST',
      signal: opts.signal,
      body: JSON.stringify({
        shipment: {
          to_address: to,
          from_address: from,
          parcel,
          // On the shipment that is RATED, because the label is bought against
          // this same shipment later and EasyPost cannot add customs to it then.
          ...(customs ? { customs_info: customs } : {}),
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
   * Buy the exact rate that was quoted — once.
   *
   * This is the step that spends money, so it refuses to improvise: without the
   * provider's own ids it throws rather than re-rating, because re-rating would
   * charge a price nobody was shown and would silently succeed while doing it.
   *
   * IDEMPOTENT BY THE SHIPMENT. EasyPost takes no idempotency key on a purchase;
   * what it has instead is that one shipment carries at most one label. So the
   * shipment is read first, and if it already has postage the label it has is
   * returned — no second purchase. That is what makes a retry safe after a
   * timeout, when the first purchase may or may not have gone through and only
   * EasyPost knows which. The caller's `idempotencyKey` is therefore not sent;
   * the shipment id is the key.
   *
   * A refusal (4xx on the purchase itself) is reported as
   * `LabelNotPurchasedError`, the one failure after which the caller can be
   * sure nothing was bought. Anything else — a timeout, a 5xx, a dropped
   * connection — leaves the outcome unknown and is thrown as it is.
   */
  async buyLabel(rate: Rate, _req: RateRequest, opts: ShippingCallOptions = {}): Promise<LabelResult> {
    if (!rate.providerShipmentId || !rate.providerRateId) {
      throw new Error(
        'This rate did not come from EasyPost, so there is nothing to buy. A label can only be ' +
          'purchased against the shipment and rate the carrier quoted.',
      );
    }
    const path = `/shipments/${encodeURIComponent(rate.providerShipmentId)}`;

    const existing = await this.call<EasyPostShipment>(path, { method: 'GET', signal: opts.signal });
    if (existing.tracking_code) return this.labelOf(existing, rate);

    let bought: EasyPostShipment;
    try {
      bought = await this.call<EasyPostShipment>(`${path}/buy`, {
        method: 'POST',
        signal: opts.signal,
        body: JSON.stringify({ rate: { id: rate.providerRateId } }),
      });
    } catch (err) {
      if (err instanceof EasyPostError && err.status >= 400 && err.status < 500) {
        throw new LabelNotPurchasedError(err.message);
      }
      throw err;
    }

    if (!bought.tracking_code) {
      throw new Error(
        `EasyPost accepted the purchase but returned no tracking code for shipment ` +
          `${rate.providerShipmentId}. The label may have been bought; a retry reads the ` +
          `shipment first and will not buy it twice.`,
      );
    }
    return this.labelOf(bought, rate);
  }

  private labelOf(bought: EasyPostShipment, rate: Rate): LabelResult {
    return {
      trackingNumber: bought.tracking_code!,
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
