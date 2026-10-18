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

const TEST_HOST = 'https://api.easypost.com/v2';

const gramsToOunces = (grams: number): number => Math.max(0.1, Number((grams / 28.3495).toFixed(2)));

const cmToInches = (cm: number): number => Number((cm / 2.54).toFixed(2));

const toMinor = (value: string): number => Math.round(Number(value) * 100);

const toDecimal = (minor: number): string => (minor / 100).toFixed(2);

const DEFAULT_TIMEOUT_MS = 20_000;

const EEI_THRESHOLD_MINOR = 2_500_00;

const EEL_PFC_CANADA = 'NOEEI 30.36';
const EEL_PFC_LOW_VALUE = 'NOEEI 30.37(a)';

export class EasyPostError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'EasyPostError';
  }
}

export interface EasyPostConfig {
  apiKey: string;
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

  get isTestMode(): boolean {
    return this.config.apiKey.startsWith('EZTK');
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      headers: {
        authorization: `Basic ${Buffer.from(`${this.config.apiKey}:`).toString('base64')}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 500);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string; errors?: unknown[] } };
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
      }
      throw new EasyPostError(`EasyPost ${res.status} on ${path}: ${detail}`, res.status, detail);
    }
    return JSON.parse(text) as T;
  }

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
        value: toDecimal(line.valueMinor),
        currency: customs.currency,
        weight: gramsToOunces(line.weightGrams),
        hs_tariff_number: line.hsCode.replace(/\D/g, ''),
        origin_country: line.originCountry.toUpperCase(),
      })),
    };
  }

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
          ...(customs ? { customs_info: customs } : {}),
          options: {
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
        estimatedDays: r.delivery_days ?? r.est_delivery_days ?? 0,
        providerShipmentId: shipment.id,
        providerRateId: r.id,
      }))
      .sort((a, b) => a.costMinor - b.costMinor);
  }

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
      labelObjectKey: bought.postage_label?.label_url ?? '',
      costMinor: bought.selected_rate ? toMinor(bought.selected_rate.rate) : rate.costMinor,
      currency: bought.selected_rate?.currency ?? rate.currency,
    };
  }

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
