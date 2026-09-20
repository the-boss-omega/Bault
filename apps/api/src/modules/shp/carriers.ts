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

import { DIM_DIVISOR, type BillingIncrement } from '@bault/adapters';

/** Where the parcel is going. Country is ISO 3166-1 alpha-2. */
/**
 * Where a parcel is going.
 *
 * `country` + `postalCode` were once the whole of it, which was enough for the
 * sandbox's crude distance band and is NOT enough for a real carrier — EasyPost
 * rates on the origin/destination pair and needs a street. The extra fields are
 * optional so a free-text destination still quotes (and is refused by the real
 * adapter with a sentence naming what is missing) rather than failing at the
 * type level.
 */
export interface Destination {
  country: string;
  postalCode: string;
  name?: string;
  street1?: string;
  street2?: string;
  city?: string;
  region?: string;
  /** So a courier can reach the recipient; some carriers require it internationally. */
  phone?: string;
}

/**
 * Where a stored shipment is going, as a carrier needs it.
 *
 * The snapshot when there is one; otherwise the country/postcode pair, which is
 * all a shipment created before the snapshot existed ever recorded. A carrier
 * that needs a street will refuse the fallback with a sentence naming what is
 * missing, which is the right failure — quoting against a guessed street would
 * be worse.
 */
export function destinationOf(s: {
  destinationDetail: unknown;
  destinationCountry: string;
  destinationPostalCode: string;
  recipientName?: string | null;
}): Destination {
  const detail = s.destinationDetail as Partial<Destination> | null;
  if (detail && typeof detail.country === 'string' && typeof detail.postalCode === 'string') {
    return { ...detail, country: detail.country, postalCode: detail.postalCode } as Destination;
  }
  return {
    country: s.destinationCountry,
    postalCode: s.destinationPostalCode,
    ...(s.recipientName ? { name: s.recipientName } : {}),
  };
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
   * The unit this service meters weight in.
   *
   * Published rather than kept inside the adapter, because it is the reason a
   * quote for 1.1 lb and one for 1.9 lb come back identical, and a collector
   * shaving grams off a parcel deserves to know it will not help.
   */
  billingIncrement: BillingIncrement;
  /** Longest single side the service accepts, in cm. 0 = no limit. */
  maxLongestSideCm: number;
  /**
   * The most the three sides may add up to, in cm. 0 = no limit.
   *
   * ePacket is the one with a real figure here: 24 inches on the longest side
   * and 36 inches for length + width + height. A large or extra-large Bault box
   * exceeds the second one before anything is put in it, which is a refusal the
   * catalogue could not previously express — so the cheapest international
   * service was being offered for parcels it would have rejected at the counter.
   */
  maxDimensionSumCm: number;
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
    billingIncrement: 'ounce',
    maxLongestSideCm: 0,
    maxDimensionSumCm: 0,
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
    billingIncrement: 'pound',
    maxLongestSideCm: 0,
    maxDimensionSumCm: 0,
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
    billingIncrement: 'pound',
    maxLongestSideCm: 0,
    maxDimensionSumCm: 0,
    dimDivisor: DIM_DIVISOR,
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
    billingIncrement: 'ounce',
    maxLongestSideCm: 60.96, // 24 in
    maxDimensionSumCm: 91.44, // 36 in, L+W+H
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
    billingIncrement: 'pound',
    maxLongestSideCm: 0,
    maxDimensionSumCm: 0,
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
    billingIncrement: 'pound',
    maxLongestSideCm: 0,
    maxDimensionSumCm: 0,
    dimDivisor: DIM_DIVISOR,
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
    billingIncrement: 'continuous',
    maxLongestSideCm: 0,
    maxDimensionSumCm: 0,
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
  /**
   * Outer dimensions of the chosen box, in cm. Sent to the carrier, which bills
   * dimensional weight itself. Absent when nobody chose a box.
   */
  dimensionsCm?: { length: number; width: number; height: number };
  /** What the chosen box weighs. Absent when nobody chose a box. */
  packagingGrams?: number;
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
    | 'origin_facility'
    | 'dimensions';
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

/** Centimetres as inches, because every carrier limit is published in them. */
function inches(cm: number): string {
  return `${Math.round(cm / 2.54)} in`;
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
  // The box counts towards the ceiling once it is known: a carrier weighs the
  // parcel, not what is inside it.
  if (parcel.weightGrams + (parcel.packagingGrams ?? 0) > service.maxWeightGrams) {
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
  /**
   * The box is too big for this service, whatever is in it.
   *
   * ePacket is the one that carries real figures — 24 inches on the longest
   * side, 36 inches for the three sides added together — and a large Bault box
   * breaks the second one empty. The catalogue could not express this before, so
   * the cheapest international service was offered for parcels a counter would
   * have handed straight back.
   *
   * Only checked when a box is known. With no dimensions there is nothing to
   * measure, and refusing on a number nobody supplied would be worse than
   * quoting optimistically — which is itself an argument for `chooseBox` always
   * producing one.
   */
  if (parcel.dimensionsCm) {
    const { length, width, height } = parcel.dimensionsCm;
    const longest = Math.max(length, width, height);
    if (service.maxLongestSideCm > 0 && longest > service.maxLongestSideCm) {
      problems.push({
        rule: 'dimensions',
        message: `${service.carrier} ${service.serviceLevel} takes nothing longer than ${inches(service.maxLongestSideCm)}.`,
        limit: inches(service.maxLongestSideCm),
      });
    }
    if (service.maxDimensionSumCm > 0 && length + width + height > service.maxDimensionSumCm) {
      problems.push({
        rule: 'dimensions',
        message: `${service.carrier} ${service.serviceLevel} takes up to ${inches(service.maxDimensionSumCm)} for length, width and height added together.`,
        limit: inches(service.maxDimensionSumCm),
      });
    }
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
