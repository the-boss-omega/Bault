import { DIM_DIVISOR, type BillingIncrement, type Rate } from '@bault/adapters';

export interface Destination {
  country: string;
  postalCode: string;
  name?: string;
  street1?: string;
  city?: string;
  region?: string;
}

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
  key: string;
  carrier: string;
  serviceLevel: string;
  scope: 'domestic' | 'international';
  countries: readonly string[];
  maxWeightGrams: number;
  maxCustomsValueMinor: number;
  maxInsuredValueMinor: number;
  signatureAvailable: boolean;
  transitDaysMin: number;
  transitDaysMax: number;
  dimDivisor?: number;
  billingIncrement: BillingIncrement;
  maxLongestSideCm: number;
  maxDimensionSumCm: number;
  flatCostMinor?: number;
  maxItems?: number;
  requiresOriginFacility?: string;
  easypost?: { carrier: string; services: readonly string[] };
}

export const DOMESTIC_COUNTRY = 'US';

const EPACKET_COUNTRIES = [
  'AU', 'AT', 'BE', 'BR', 'CA', 'CH', 'CN', 'CZ', 'DE', 'DK',
  'ES', 'FI', 'FR', 'GB', 'GR', 'HK', 'HU', 'IE', 'IL', 'IT',
  'JP', 'KR', 'LU', 'MX', 'MY', 'NL', 'NO', 'NZ', 'PL', 'PT',
  'SE', 'SG',
] as const;

export const DIRECT_OVERNIGHT_KEY = 'direct_overnight';

export const DIRECT_OVERNIGHT_FACILITY = 'DE';

export const CARRIER_SERVICES: readonly CarrierService[] = [
  {
    key: 'usps_ground',
    carrier: 'USPS',
    serviceLevel: 'Ground Advantage',
    scope: 'domestic',
    countries: [DOMESTIC_COUNTRY],
    maxWeightGrams: 31_751,
    maxCustomsValueMinor: 0,
    maxInsuredValueMinor: 500_000,
    signatureAvailable: true,
    transitDaysMin: 3,
    transitDaysMax: 6,
    billingIncrement: 'ounce',
    maxLongestSideCm: 0,
    maxDimensionSumCm: 0,
    easypost: { carrier: 'USPS', services: ['GroundAdvantage'] },
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
    easypost: { carrier: 'USPS', services: ['Priority'] },
  },
  {
    key: 'fedex_2day',
    carrier: 'FedEx',
    serviceLevel: '2Day',
    scope: 'domestic',
    countries: [DOMESTIC_COUNTRY],
    maxWeightGrams: 68_039,
    maxCustomsValueMinor: 0,
    maxInsuredValueMinor: 500_000,
    signatureAvailable: true,
    transitDaysMin: 2,
    transitDaysMax: 2,
    billingIncrement: 'pound',
    maxLongestSideCm: 0,
    maxDimensionSumCm: 0,
    dimDivisor: DIM_DIVISOR,
    easypost: { carrier: 'FedEx', services: ['FEDEX_2_DAY'] },
  },
  {
    key: 'epacket',
    carrier: 'ePacket',
    serviceLevel: 'International',
    scope: 'international',
    countries: EPACKET_COUNTRIES,
    maxWeightGrams: 1_814,
    maxCustomsValueMinor: 40_000,
    maxInsuredValueMinor: 50_000,
    signatureAvailable: false,
    transitDaysMin: 10,
    transitDaysMax: 24,
    billingIncrement: 'ounce',
    maxLongestSideCm: 60.96,
    maxDimensionSumCm: 91.44,
  },
  {
    key: 'epost',
    carrier: 'ePost',
    serviceLevel: 'International',
    scope: 'international',
    countries: [],
    maxWeightGrams: 9_072,
    maxCustomsValueMinor: 0,
    maxInsuredValueMinor: 200_000,
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
    easypost: { carrier: 'FedEx', services: ['FEDEX_INTERNATIONAL_PRIORITY', 'INTERNATIONAL_PRIORITY'] },
  },
  {
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
    flatCostMinor: 10_000,
    maxItems: 5,
    requiresOriginFacility: DIRECT_OVERNIGHT_FACILITY,
    easypost: { carrier: 'FedEx', services: ['PRIORITY_OVERNIGHT', 'STANDARD_OVERNIGHT'] },
  },
];

const BY_KEY = new Map(CARRIER_SERVICES.map((s) => [s.key, s]));

export function carrierService(key: string): CarrierService | undefined {
  return BY_KEY.get(key);
}

export function rateFor<R extends Rate>(service: CarrierService, rates: readonly R[]): R | undefined {
  const exact = rates.find((r) => r.carrier === service.carrier && r.serviceLevel === service.serviceLevel);
  if (exact) return exact;
  const ep = service.easypost;
  if (!ep) return undefined;
  for (const code of ep.services) {
    const hit = rates.find((r) => r.carrier.toLowerCase() === ep.carrier.toLowerCase() && r.serviceLevel === code);
    if (hit) return hit;
  }
  return undefined;
}

export function findService(carrier: string, serviceLevel: string): CarrierService | undefined {
  return CARRIER_SERVICES.find((s) => s.carrier === carrier && s.serviceLevel === serviceLevel);
}

export interface ParcelProfile {
  destination: Destination;
  weightGrams: number;
  dimensionsCm?: { length: number; width: number; height: number };
  packagingGrams?: number;
  itemCount: number;
  customsValueMinor: number;
  insuredValueMinor: number;
  signatureRequired: boolean;
  originFacilityCode?: string | null;
}

export interface ServiceProblem {
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
  limit?: string;
}

function usd(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function inches(cm: number): string {
  return `${Math.round(cm / 2.54)} in`;
}

function lb(grams: number): string {
  return `${(grams / 453.592).toFixed(1)} lb`;
}

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

export function eligibleServices(parcel: ParcelProfile): CarrierService[] {
  return CARRIER_SERVICES.filter((s) => checkService(s, parcel).length === 0);
}
