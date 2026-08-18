/**
 * The carrier line-up, and the limits that actually decide what you can use.
 *
 * Bault had a rate list and no constraints. `SandboxShippingAdapter` returned
 * "DHL Standard", "DHL Express" and "USPS Standard" at fixed invented prices,
 * regardless of where the parcel was going, what it weighed or what was in it —
 * and the rate request hard-coded the destination as country `IL`, postal code
 * `00000`, with every item assumed to be 500 g.
 *
 * That is a shape, not a shipping product. A real carrier line-up is defined by
 * what each service REFUSES:
 *
 *   - ePacket goes only to countries the carrier has a contract with, caps out
 *     at 4 lb, will not carry more than $400 of declared customs value, and will
 *     not insure past $500;
 *   - ePost carries more weight and more insurance but is slower;
 *   - FedEx International prices on DIMENSIONAL weight, which is why a light
 *     parcel in a big box costs what a heavy one does;
 *   - domestic services do not cross a border at all.
 *
 * Those limits are the product. A collector choosing "the cheap one" for a
 * $3,000 slab going to Germany needs to be told, before they pay, that the cheap
 * one will not insure it — not after a claim is refused.
 *
 * This module is pure data plus predicates. It talks to nothing, so all of it is
 * directly testable, and `apps/web/src/shared/carriers.ts` mirrors the SHAPE by
 * value while the SPA fetches the actual list from `GET /shipping/services`.
 */

/** Where the parcel is going. Country is ISO 3166-1 alpha-2. */
export interface Destination {
  country: string;
  postalCode: string;
}

export interface CarrierService {
  /** Stable key. Named by pricing rules and stored on the shipment. */
  key: string;
  carrier: string;
  serviceLevel: string;
  /** Domestic services never cross a border; international ones always do. */
  scope: 'domestic' | 'international';
  /**
   * The countries this service reaches. Empty means "anywhere in scope" —
   * ePacket is the one that carries a real contracted list.
   */
  countries: readonly string[];
  maxWeightGrams: number;
  /** The most customs value the service will carry. 0 = no ceiling. */
  maxCustomsValueMinor: number;
  /** The most it will insure. 0 = will not insure at all. */
  maxInsuredValueMinor: number;
  /** Whether a signature can be demanded on this service. */
  signatureAvailable: boolean;
  transitDaysMin: number;
  transitDaysMax: number;
  /**
   * Dimensional-weight divisor, published because it is the reason a light
   * parcel in a big box is priced like a heavy one. Absent means the service
   * prices on actual weight only.
   */
  dimDivisor?: number;
  /**
   * A flat price that ignores weight and distance entirely. Only the
   * direct-overnight service has one — see {@link DIRECT_OVERNIGHT_KEY}.
   */
  flatCostMinor?: number;
  /** A hard cap on how many items may travel on this service. */
  maxItems?: number;
  /** Only offered when every item is already at this facility code. */
  requiresOriginFacility?: string;
}

/** The United States. Both facilities are here, so this is the domestic country. */
export const DOMESTIC_COUNTRY = 'US';

/**
 * The countries ePacket is contracted to. Not a policy Bault sets — it is the
 * carrier's list, and shipping to anywhere else on this service is simply not a
 * thing that can be bought.
 */
const EPACKET_COUNTRIES = [
  'AU', 'AT', 'BE', 'BR', 'CA', 'CH', 'CN', 'CZ', 'DE', 'DK',
  'ES', 'FI', 'FR', 'GB', 'GR', 'HK', 'HU', 'IE', 'IL', 'IT',
  'JP', 'KR', 'LU', 'MX', 'MY', 'NL', 'NO', 'NZ', 'PL', 'PT',
  'SE', 'SG',
] as const;

/** The direct-from-Delaware overnight service. Its rules are unlike any other. */
export const DIRECT_OVERNIGHT_KEY = 'direct_overnight';

/** The forwarding facility the overnight service leaves from. */
export const DIRECT_OVERNIGHT_FACILITY = 'DE';

export const CARRIER_SERVICES: readonly CarrierService[] = [
  {
    key: 'usps_ground',
    carrier: 'USPS',
    serviceLevel: 'Ground Advantage',
    scope: 'domestic',
    countries: [DOMESTIC_COUNTRY],
    maxWeightGrams: 31_751, // 70 lb
    maxCustomsValueMinor: 0,
    maxInsuredValueMinor: 500_000, // $5,000
    signatureAvailable: true,
    transitDaysMin: 3,
    transitDaysMax: 6,
  },
  {
    key: 'usps_priority',
    carrier: 'USPS',
    serviceLevel: 'Priority Mail',
    scope: 'domestic',
    countries: [DOMESTIC_COUNTRY],
    maxWeightGrams: 31_751,
    maxCustomsValueMinor: 0,
    maxInsuredValueMinor: 500_000,
    signatureAvailable: true,
    transitDaysMin: 1,
    transitDaysMax: 3,
  },
  {
    key: 'fedex_2day',
    carrier: 'FedEx',
    serviceLevel: '2Day',
    scope: 'domestic',
    countries: [DOMESTIC_COUNTRY],
    maxWeightGrams: 68_039, // 150 lb
    maxCustomsValueMinor: 0,
    maxInsuredValueMinor: 500_000,
    signatureAvailable: true,
    transitDaysMin: 2,
    transitDaysMax: 2,
    dimDivisor: 139,
  },
  {
    key: 'epacket',
    carrier: 'ePacket',
    serviceLevel: 'International',
    scope: 'international',
    countries: EPACKET_COUNTRIES,
    maxWeightGrams: 1_814, // 4 lb
    maxCustomsValueMinor: 40_000, // $400
    maxInsuredValueMinor: 50_000, // $500
    signatureAvailable: false,
    transitDaysMin: 10,
    transitDaysMax: 24,
  },
  {
    key: 'epost',
    carrier: 'ePost',
    serviceLevel: 'International',
    scope: 'international',
    countries: [],
    maxWeightGrams: 9_072, // 20 lb
    maxCustomsValueMinor: 0,
    maxInsuredValueMinor: 200_000, // $2,000
    signatureAvailable: true,
    transitDaysMin: 7,
    transitDaysMax: 16,
  },
  {
    key: 'fedex_intl_priority',
    carrier: 'FedEx',
    serviceLevel: 'International Priority',
    scope: 'international',
    countries: [],
    maxWeightGrams: 68_039,
    maxCustomsValueMinor: 0,
    maxInsuredValueMinor: 500_000,
    signatureAvailable: true,
    transitDaysMin: 2,
    transitDaysMax: 5,
    dimDivisor: 139,
  },
  {
    /**
     * Straight out of the tax-free forwarding site, overnight, instead of being
     * trucked to the vault first and shipped from there.
     *
     * Every rule on it is a real constraint rather than a preference: it leaves
     * from one specific building, so every item has to already be there; it is
     * an envelope, so it takes five cards and no more; and it is domestic
     * because an overnight international parcel is a different product at a
     * different price.
     */
    key: DIRECT_OVERNIGHT_KEY,
    carrier: 'FedEx',
    serviceLevel: 'Direct Overnight',
    scope: 'domestic',
    countries: [DOMESTIC_COUNTRY],
    maxWeightGrams: 500,
    maxCustomsValueMinor: 0,
    maxInsuredValueMinor: 500_000,
    signatureAvailable: true,
    transitDaysMin: 1,
    transitDaysMax: 1,
    flatCostMinor: 10_000, // $100 flat
    maxItems: 5,
    requiresOriginFacility: DIRECT_OVERNIGHT_FACILITY,
  },
];

const BY_KEY = new Map(CARRIER_SERVICES.map((s) => [s.key, s]));

export function carrierService(key: string): CarrierService | undefined {
  return BY_KEY.get(key);
}

/** Resolve by the carrier/service pair the shipment stores. */
export function findService(carrier: string, serviceLevel: string): CarrierService | undefined {
  return CARRIER_SERVICES.find((s) => s.carrier === carrier && s.serviceLevel === serviceLevel);
}

/** What a parcel is, as far as choosing a service goes. */
export interface ParcelProfile {
  destination: Destination;
  weightGrams: number;
  /** Longest × middle × shortest, in cm. Used only where dim weight applies. */
  dimensionsCm?: { length: number; width: number; height: number };
  itemCount: number;
  /** Total declared customs value. Zero on a domestic parcel. */
  customsValueMinor: number;
  /** What the collector wants covered. Zero means no insurance. */
  insuredValueMinor: number;
  signatureRequired: boolean;
  /** Facility code every item currently sits in, when they all share one. */
  originFacilityCode?: string | null;
}

export interface ServiceProblem {
  /** The rule that failed, so the SPA can phrase it without parsing English. */
  rule:
    | 'scope'
    | 'country'
    | 'weight'
    | 'customs_value'
    | 'insurance'
    | 'signature'
    | 'item_count'
    | 'origin_facility';
  message: string;
  /**
   * The limit that was exceeded, already formatted ("$500.00", "4.0 lb", "5").
   *
   * Sent separately so the SPA can translate the SENTENCE while keeping the
   * number — a Hebrew reader being handed "ePacket International insures up to
   * $500.00" in English loses the phrasing, and being handed a translated
   * sentence with no figure in it loses the only actionable part.
   */
  limit?: string;
}

function usd(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function lb(grams: number): string {
  return `${(grams / 453.592).toFixed(1)} lb`;
}

/**
 * Every reason this service cannot carry this parcel.
 *
 * All of them, not the first — somebody whose parcel is both too heavy and too
 * valuable for ePacket should learn both facts at once rather than fixing one
 * and being refused again.
 */
export function checkService(service: CarrierService, parcel: ParcelProfile): ServiceProblem[] {
  const problems: ServiceProblem[] = [];
  const international = parcel.destination.country !== DOMESTIC_COUNTRY;

  if (international && service.scope === 'domestic') {
    problems.push({
      rule: 'scope',
      message: `${service.carrier} ${service.serviceLevel} does not cross a border.`,
    });
  }
  if (!international && service.scope === 'international') {
    problems.push({
      rule: 'scope',
      message: `${service.carrier} ${service.serviceLevel} is an international service.`,
    });
  }
  if (service.countries.length > 0 && !service.countries.includes(parcel.destination.country)) {
    problems.push({
      rule: 'country',
      message: `${service.carrier} ${service.serviceLevel} is not contracted to ${parcel.destination.country}.`,
      limit: parcel.destination.country,
    });
  }
  if (parcel.weightGrams > service.maxWeightGrams) {
    problems.push({
      rule: 'weight',
      message: `${service.carrier} ${service.serviceLevel} carries up to ${lb(service.maxWeightGrams)}.`,
      limit: lb(service.maxWeightGrams),
    });
  }
  if (service.maxCustomsValueMinor > 0 && parcel.customsValueMinor > service.maxCustomsValueMinor) {
    problems.push({
      rule: 'customs_value',
      message: `${service.carrier} ${service.serviceLevel} carries up to ${usd(service.maxCustomsValueMinor)} of declared value.`,
      limit: usd(service.maxCustomsValueMinor),
    });
  }
  if (parcel.insuredValueMinor > 0 && parcel.insuredValueMinor > service.maxInsuredValueMinor) {
    problems.push({
      rule: 'insurance',
      message:
        service.maxInsuredValueMinor === 0
          ? `${service.carrier} ${service.serviceLevel} cannot be insured.`
          : `${service.carrier} ${service.serviceLevel} insures up to ${usd(service.maxInsuredValueMinor)}.`,
      limit: service.maxInsuredValueMinor === 0 ? '—' : usd(service.maxInsuredValueMinor),
    });
  }
  if (parcel.signatureRequired && !service.signatureAvailable) {
    problems.push({
      rule: 'signature',
      message: `${service.carrier} ${service.serviceLevel} cannot collect a signature.`,
    });
  }
  if (service.maxItems !== undefined && parcel.itemCount > service.maxItems) {
    problems.push({
      rule: 'item_count',
      message: `${service.carrier} ${service.serviceLevel} carries at most ${service.maxItems} items.`,
      limit: String(service.maxItems),
    });
  }
  if (service.requiresOriginFacility && parcel.originFacilityCode !== service.requiresOriginFacility) {
    problems.push({
      rule: 'origin_facility',
      message: `${service.carrier} ${service.serviceLevel} ships only from the ${service.requiresOriginFacility} facility.`,
      limit: service.requiresOriginFacility,
    });
  }
  return problems;
}

/** Services that can actually carry this parcel. */
export function eligibleServices(parcel: ParcelProfile): CarrierService[] {
  return CARRIER_SERVICES.filter((s) => checkService(s, parcel).length === 0);
}

/**
 * Billable weight: the greater of what it weighs and what its size says it
 * weighs.
 *
 * This is not a Bault invention and it is not a rounding trick — a carrier sells
 * space in an aircraft, and a shoebox of sleeved commons occupies the same space
 * as something four times its mass. Services without a divisor bill actual
 * weight.
 */
export function billableWeightGrams(service: CarrierService, parcel: ParcelProfile): number {
  if (!service.dimDivisor || !parcel.dimensionsCm) return parcel.weightGrams;
  const { length, width, height } = parcel.dimensionsCm;
  // The divisor is published in cubic-inches-per-pound, so the volume is
  // converted rather than the divisor.
  const cubicInches = (length * width * height) / 16.387;
  const dimPounds = cubicInches / service.dimDivisor;
  return Math.max(parcel.weightGrams, Math.round(dimPounds * 453.592));
}
