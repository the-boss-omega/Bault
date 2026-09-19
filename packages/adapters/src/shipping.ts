/**
 * Shipping adapter (T020) — a carrier API behind one interface.
 * Provides carrier rates, label purchase, and tracking. Rush handling is a flag.
 *
 * Two implementations: `EasyPostShippingAdapter` (real carriers, real labels)
 * and `SandboxShippingAdapter` (invented prices, fake labels). The choice is
 * made from validated config in `AdaptersModule`, and the sandbox is refused in
 * production — a customer charged for a label that cannot be printed is the
 * worst failure this module has.
 */

/**
 * A postal address, as a carrier needs it.
 *
 * Only `country` and `postalCode` are required, because that is all the sandbox
 * ever needed and all the quoting flow could originally supply. A REAL carrier
 * cannot rate on that alone — it needs a street — so `EasyPostShippingAdapter`
 * refuses a request missing one, loudly, rather than quoting a number that would
 * change at label time.
 */
export interface ShipAddress {
  country: string;
  postalCode: string;
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  city?: string;
  /** State / province, in the carrier's two-letter form where there is one. */
  region?: string;
  phone?: string;
  email?: string;
}

/**
 * The packaging allowance when nobody has said which box.
 *
 * Packaging is not weightless: a parcel is the cards plus the box, and quoting the
 * contents alone under-declares every shipment.
 */
export const DEFAULT_PACKAGING_GRAMS = 120;

/**
 * The dimensional-weight divisor, in cubic inches per pound.
 *
 * A carrier sells space as well as lift, and bills whichever is greater. The
 * divisor is how the space is converted into a weight:
 *
 *     dimensional pounds = (L × W × H in inches) / DIM_DIVISOR
 *
 * **167, because that is the figure the reference service publishes.** Its FAQ
 * states the formula as `(L × W × H) / 167` and quotes prices against it, so a
 * Bault quote computed with a different divisor is a quote for a different
 * parcel. It was 139 here — the domestic retail figure FedEx and UPS use for
 * some US services — which is the more expensive end and over-quoted every
 * boxed parcel by about 20%.
 *
 * One constant, exported, so the adapter and the carrier catalogue cannot drift
 * apart on the number that decides the price.
 */
export const DIM_DIVISOR = 167;

/** Cubic centimetres per cubic inch — the other half of the conversion. */
export const CM3_PER_IN3 = 16.387;

/** Grams in a pound. */
export const GRAMS_PER_LB = 453.592;

/** Grams in an ounce. */
export const GRAMS_PER_OZ = 28.3495;

/**
 * How a service meters weight.
 *
 * Carriers do not sell fractions. A parcel is weighed, the figure is rounded UP
 * to the next whole unit, and that is what is billed — so 1.02 lb and 1.98 lb
 * cost the same, and 2.01 lb costs a band more. Quoting on the continuous weight
 * instead, which is what this adapter used to do, under-quotes almost every
 * parcel by up to one whole unit.
 *
 * The reference service publishes the unit per service in its FAQ: *"Postage
 * amount is charged per pound"* for ePost, and *per ounce* for ePacket. The
 * FedEx and USPS figures are the carriers' own published behaviour.
 *
 * `continuous` exists for the flat-rate service, which meters nothing at all.
 */
export type BillingIncrement = 'ounce' | 'pound' | 'continuous';

/**
 * The weight a carrier will actually bill.
 *
 * Two steps, in this order, and the order matters: take the greater of what the
 * parcel WEIGHS and what its VOLUME is worth, and only then round up to the
 * service's unit. Rounding first and comparing second would round the loser as
 * well, which costs nothing but is one more number that has to be right.
 */
export function billableGrams(
  actualGrams: number,
  dimGrams: number,
  increment: BillingIncrement,
): number {
  const greater = Math.max(actualGrams, dimGrams);
  if (increment === 'continuous') return greater;
  const unit = increment === 'pound' ? GRAMS_PER_LB : GRAMS_PER_OZ;
  // At least one whole unit: nobody ships a zero-ounce parcel.
  return Math.max(1, Math.ceil(greater / unit)) * unit;
}

/**
 * What a box's outer dimensions weigh, as far as a carrier is concerned.
 *
 * Returns 0 when no box is known, which is the honest answer: with no
 * dimensions there is no volume to bill, so the parcel prices on actual weight
 * alone and a light-but-bulky one is under-quoted. That is the reason Bault
 * chooses a box rather than leaving it blank.
 */
export function dimensionalGrams(dims?: { length: number; width: number; height: number }): number {
  if (!dims) return 0;
  const cubicInches = (dims.length * dims.width * dims.height) / CM3_PER_IN3;
  return Math.round((cubicInches / DIM_DIVISOR) * GRAMS_PER_LB);
}

export interface RateRequest {
  destination: ShipAddress;
  /**
   * Where the parcel physically ships FROM — the facility holding the goods.
   *
   * Optional only because the sandbox never used it. A real carrier prices on
   * the origin/destination pair, so quoting without it is quoting a different
   * shipment than the one that will be bought.
   */
  origin?: ShipAddress;
  items: { weightGrams: number }[];
  rush: boolean;
  /**
   * The services the caller is willing to consider, by carrier/service pair.
   *
   * The CALLER decides what is eligible — it knows the parcel's insured value,
   * its customs value, how many items are in it and which building they are in,
   * and none of that belongs in a rate adapter. Omitted means "quote everything
   * you have".
   */
  services?: { carrier: string; serviceLevel: string }[];
  /** Outer dimensions in cm, where the caller knows them. Drives dim weight. */
  dimensionsCm?: { length: number; width: number; height: number };
  /**
   * What the box and its padding weigh, where the caller knows the box.
   * Omitted means {@link DEFAULT_PACKAGING_GRAMS}.
   */
  packagingGrams?: number;
  /** Whether the carrier must collect a signature. Some services surcharge it. */
  signatureRequired?: boolean;
}

export interface Rate {
  carrier: string;
  serviceLevel: string;
  costMinor: number;
  currency: string;
  estimatedDays: number;
  /**
   * The provider's own handles for this quote.
   *
   * A real carrier does not let you buy "FedEx 2Day at $18.50" — you buy THE
   * RATE IT QUOTED, by id, against the shipment it was quoted for. Carrying them
   * here is what makes `buyLabel` able to purchase the exact price the collector
   * was shown, instead of re-rating at label time and charging something else.
   *
   * Undefined for the sandbox, which has nothing to refer to.
   */
  providerShipmentId?: string;
  providerRateId?: string;
}

export interface LabelResult {
  trackingNumber: string;
  labelObjectKey: string;
  costMinor: number;
  currency: string;
}

export interface TrackingStatus {
  trackingNumber: string;
  status: 'in_transit' | 'delivered' | 'exception' | 'unknown';
}

export interface ShippingAdapter {
  getRates(req: RateRequest): Promise<Rate[]>;
  buyLabel(rate: Rate, req: RateRequest): Promise<LabelResult>;
  getTracking(trackingNumber: string): Promise<TrackingStatus>;
}

/* ============================================================
   Sandbox
   ============================================================ */

/** One quotable service, and the shape of its price. */
interface SandboxService {
  carrier: string;
  serviceLevel: string;
  international: boolean;
  /** What it costs before any weight at all. */
  baseMinor: number;
  /** Added per kilogram of billable weight. */
  perKgMinor: number;
  estimatedDays: number;
  /** Flat services ignore weight entirely. */
  flatMinor?: number;
  /** Cost of collecting a signature, where the service offers it. */
  signatureMinor?: number;
  /** The unit this service meters weight in. See {@link BillingIncrement}. */
  increment: BillingIncrement;
}

/**
 * The prices this sandbox quotes.
 *
 * These are invented, and deliberately labelled as such — Bault has no carrier
 * account, so nothing here can be a real rate. What IS real is the SHAPE: a base
 * plus a per-kilogram component, international costing several times domestic,
 * express costing several times ground, and a signature surcharge. A quote that
 * moves when the parcel gets heavier or the destination gets further away
 * exercises every code path a real integration would, which the old two-fixed-
 * prices stub did not.
 */
const SANDBOX_SERVICES: readonly SandboxService[] = [
  { carrier: 'USPS', serviceLevel: 'Ground Advantage', international: false, baseMinor: 550, perKgMinor: 420, estimatedDays: 4, signatureMinor: 340, increment: 'ounce' },
  { carrier: 'USPS', serviceLevel: 'Priority Mail', international: false, baseMinor: 980, perKgMinor: 690, estimatedDays: 2, signatureMinor: 340, increment: 'pound' },
  { carrier: 'FedEx', serviceLevel: '2Day', international: false, baseMinor: 1_850, perKgMinor: 890, estimatedDays: 2, signatureMinor: 590, increment: 'pound' },
  { carrier: 'FedEx', serviceLevel: 'Direct Overnight', international: false, baseMinor: 0, perKgMinor: 0, estimatedDays: 1, flatMinor: 10_000, signatureMinor: 0, increment: 'continuous' },
  { carrier: 'ePacket', serviceLevel: 'International', international: true, baseMinor: 1_150, perKgMinor: 1_400, estimatedDays: 16, increment: 'ounce' },
  { carrier: 'ePost', serviceLevel: 'International', international: true, baseMinor: 1_950, perKgMinor: 2_100, estimatedDays: 11, signatureMinor: 620, increment: 'pound' },
  { carrier: 'FedEx', serviceLevel: 'International Priority', international: true, baseMinor: 4_200, perKgMinor: 3_400, estimatedDays: 3, signatureMinor: 590, increment: 'pound' },
];

/** The origin. Everything Bault ships leaves the United States. */
const ORIGIN_COUNTRY = 'US';

/**
 * A crude distance band, so a quote to Australia is not a quote to Canada.
 *
 * Postal codes are ignored, which is the honest limitation: a real carrier
 * prices on zone, and deriving a zone from a postcode needs the carrier's own
 * tables. Country is the granularity this can actually support.
 */
function distanceMultiplier(country: string): number {
  const c = country.toUpperCase();
  if (c === ORIGIN_COUNTRY) return 1;
  if (['CA', 'MX'].includes(c)) return 1.25;
  if (['GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'ES', 'IT', 'PT', 'DK', 'SE', 'NO', 'FI', 'AT', 'CH', 'PL', 'CZ', 'HU', 'GR', 'LU'].includes(c)) return 1.6;
  return 2.1;
}

export class SandboxShippingAdapter implements ShippingAdapter {
  async getRates(req: RateRequest): Promise<Rate[]> {
    const international = req.destination.country.toUpperCase() !== ORIGIN_COUNTRY;
    const actualGrams = req.items.reduce((sum, i) => sum + Math.max(0, i.weightGrams), 0);

    // Packaging is not weightless. A parcel is the cards plus the box, and
    // quoting the contents alone under-declares every shipment.
    const packagedGrams = actualGrams + (req.packagingGrams ?? DEFAULT_PACKAGING_GRAMS);

    // A carrier bills the greater of what the parcel weighs and what its volume
    // is worth. One shared function, so the divisor lives in exactly one place.
    const dimGrams = dimensionalGrams(req.dimensionsCm);

    const wanted = req.services;
    const multiplier = distanceMultiplier(req.destination.country);

    return SANDBOX_SERVICES.filter((s) => s.international === international)
      .filter((s) => !wanted || wanted.some((w) => w.carrier === s.carrier && w.serviceLevel === s.serviceLevel))
      .map((s) => {
        // Rounded UP to this service's unit. Carriers do not sell fractions:
        // 1.02 lb and 1.98 lb are the same parcel to a per-pound service.
        const billableKg = billableGrams(packagedGrams, dimGrams, s.increment) / 1000;
        const signature = req.signatureRequired ? (s.signatureMinor ?? 0) : 0;
        const cost =
          s.flatMinor !== undefined
            ? s.flatMinor + signature
            : Math.round((s.baseMinor + s.perKgMinor * billableKg) * multiplier) + signature;
        return {
          carrier: s.carrier,
          serviceLevel: s.serviceLevel,
          costMinor: cost,
          currency: 'USD',
          // Rush does not change what a carrier promises — it changes how fast
          // the WAREHOUSE gets the parcel to them, which is a Bault handling
          // step, not a transit one. It used to be folded into the carrier's
          // estimate, which quietly attributed Bault's own speed to the carrier.
          estimatedDays: s.estimatedDays,
        };
      })
      .sort((a, b) => a.costMinor - b.costMinor);
  }

  async buyLabel(rate: Rate): Promise<LabelResult> {
    return {
      trackingNumber: `SBX${Math.floor(Date.now() / 1000)}`,
      labelObjectKey: `labels/sbx-${rate.carrier}.pdf`,
      costMinor: rate.costMinor,
      currency: rate.currency,
    };
  }

  async getTracking(trackingNumber: string): Promise<TrackingStatus> {
    return { trackingNumber, status: 'in_transit' };
  }
}
