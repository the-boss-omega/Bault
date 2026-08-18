/**
 * Shipping adapter (T020) — ShipStation / Easyship behind one interface.
 * Provides carrier rates, label purchase, and tracking. Rush handling is a flag.
 */
export interface RateRequest {
  destination: { country: string; postalCode: string };
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
  /** Whether the carrier must collect a signature. Some services surcharge it. */
  signatureRequired?: boolean;
}

export interface Rate {
  carrier: string;
  serviceLevel: string;
  costMinor: number;
  currency: string;
  estimatedDays: number;
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
  { carrier: 'USPS', serviceLevel: 'Ground Advantage', international: false, baseMinor: 550, perKgMinor: 420, estimatedDays: 4, signatureMinor: 340 },
  { carrier: 'USPS', serviceLevel: 'Priority Mail', international: false, baseMinor: 980, perKgMinor: 690, estimatedDays: 2, signatureMinor: 340 },
  { carrier: 'FedEx', serviceLevel: '2Day', international: false, baseMinor: 1_850, perKgMinor: 890, estimatedDays: 2, signatureMinor: 590 },
  { carrier: 'FedEx', serviceLevel: 'Direct Overnight', international: false, baseMinor: 0, perKgMinor: 0, estimatedDays: 1, flatMinor: 10_000, signatureMinor: 0 },
  { carrier: 'ePacket', serviceLevel: 'International', international: true, baseMinor: 1_150, perKgMinor: 1_400, estimatedDays: 16 },
  { carrier: 'ePost', serviceLevel: 'International', international: true, baseMinor: 1_950, perKgMinor: 2_100, estimatedDays: 11, signatureMinor: 620 },
  { carrier: 'FedEx', serviceLevel: 'International Priority', international: true, baseMinor: 4_200, perKgMinor: 3_400, estimatedDays: 3, signatureMinor: 590 },
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
    const packagedGrams = actualGrams + 120;

    const dimGrams = req.dimensionsCm
      ? Math.round(
          ((req.dimensionsCm.length * req.dimensionsCm.width * req.dimensionsCm.height) / 16.387 / 139) * 453.592,
        )
      : 0;
    const billableKg = Math.max(packagedGrams, dimGrams) / 1000;

    const wanted = req.services;
    const multiplier = distanceMultiplier(req.destination.country);

    return SANDBOX_SERVICES.filter((s) => s.international === international)
      .filter((s) => !wanted || wanted.some((w) => w.carrier === s.carrier && w.serviceLevel === s.serviceLevel))
      .map((s) => {
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
