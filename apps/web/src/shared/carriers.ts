import type { MessageKey, TranslateFn } from './i18n';

/**
 * The SPA's vocabulary for outbound shipping.
 *
 * The shapes mirror `apps/api/src/modules/shp/carriers.ts` and
 * `shipping-options.ts` by value, because the SPA cannot import from the API
 * tree. The catalogue itself is FETCHED from `GET /shipping/services` rather
 * than duplicated — a carrier's weight ceiling changing should not need a
 * client deploy — so only the translatable labels live here.
 */

export interface CarrierServiceInfo {
  key: string;
  carrier: string;
  serviceLevel: string;
  scope: 'domestic' | 'international';
  countries: string[];
  maxWeightGrams: number;
  maxCustomsValueMinor: number;
  maxInsuredValueMinor: number;
  signatureAvailable: boolean;
  transitDaysMin: number;
  transitDaysMax: number;
  flatCostMinor?: number;
  maxItems?: number;
}

export interface AddOnInfo {
  key: string;
  label: string;
  priceMinor: number;
  requiresInsuranceMinor: number;
  description: string;
}

export interface ServiceCatalogue {
  services: CarrierServiceInfo[];
  addOns: AddOnInfo[];
  maxInsuredValueMinor: number;
  signatureRequiredAboveMinor: number;
  paymentWindowDays: number;
}

/** Why a service cannot carry this parcel. */
export interface RateProblem {
  rule: string;
  message: string;
  /** The limit that was exceeded, already formatted by the server. */
  limit?: string;
}

export interface QuotedRate {
  carrier: string;
  serviceLevel: string;
  serviceKey: string;
  costMinor: number;
  currency: string;
  estimatedDays: number;
  problems: RateProblem[];
  eligible: boolean;
  transitDaysMin: number;
  transitDaysMax: number;
  maxInsuredValueMinor: number;
  handlingMinor: number;
  insurancePremiumMinor: number;
  addOnsMinor: number;
  totalMinor: number;
  recommended: boolean;
}

export interface Quote {
  destination: { country: string; postalCode: string };
  totalWeightGrams: number;
  weightEstimated: boolean;
  itemCount: number;
  insuredValueMinor: number;
  declaredValueMinor: number;
  signatureRequired: boolean;
  needsCustoms: boolean;
  rates: QuotedRate[];
  optionProblems: { field: string; message: string }[];
}

const SERVICE_KEY: Record<string, MessageKey> = {
  usps_ground: 'ship.svc.usps_ground',
  usps_priority: 'ship.svc.usps_priority',
  fedex_2day: 'ship.svc.fedex_2day',
  epacket: 'ship.svc.epacket',
  epost: 'ship.svc.epost',
  fedex_intl_priority: 'ship.svc.fedex_intl_priority',
  direct_overnight: 'ship.svc.direct_overnight',
};

/**
 * A service's name. Falls back to the carrier and service level the server
 * sent, so a service added on the server reads correctly before it is
 * translated — never a raw key.
 */
export function serviceLabel(
  t: TranslateFn,
  service: { key?: string; serviceKey?: string; carrier: string; serviceLevel: string },
): string {
  const key = SERVICE_KEY[service.key ?? service.serviceKey ?? ''];
  return key ? t(key) : `${service.carrier} ${service.serviceLevel}`;
}

/**
 * Why a service was refused, phrased locally.
 *
 * The server sends both a machine-readable `rule` and an English message. The
 * rule is preferred so the reason is translated; the message stands in for a
 * rule this build does not know about, which is better than showing nothing.
 */
const RULE_KEY: Record<string, MessageKey> = {
  scope: 'ship.rule.scope',
  country: 'ship.rule.country',
  weight: 'ship.rule.weight',
  customs_value: 'ship.rule.customs_value',
  insurance: 'ship.rule.insurance',
  signature: 'ship.rule.signature',
  item_count: 'ship.rule.item_count',
  origin_facility: 'ship.rule.origin_facility',
};

export function ruleLabel(t: TranslateFn, problem: RateProblem): string {
  const key = RULE_KEY[problem.rule];
  return key ? t(key, { limit: problem.limit ?? '' }) : problem.message;
}

/** Grams → a readable weight. Kept here so the list and the drawer agree. */
export function formatWeight(grams: number): string {
  if (grams < 1000) return `${grams} g`;
  return `${(grams / 1000).toFixed(grams < 10_000 ? 2 : 1)} kg`;
}
