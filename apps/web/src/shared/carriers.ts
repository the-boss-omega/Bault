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

/** A box a parcel can go out in. Mirrors `SHIPPING_BOXES` in shp/boxes.ts. */
export interface BoxInfo {
  key: string;
  label: string;
  dimensionsCm: { length: number; width: number; height: number };
  tareGrams: number;
  maxContentsGrams: number;
}

export interface ServiceCatalogue {
  services: CarrierServiceInfo[];
  addOns: AddOnInfo[];
  boxes: BoxInfo[];
  maxInsuredValueMinor: number;
  signatureRequiredAboveMinor: number;
  paymentWindowDays: number;
  /** What cancelling costs once a service has been paid for. */
  restockingFeeMinor?: number;
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
  /**
   * What the member's tier paid towards this rate. `totalMinor` is already net
   * of it; this is here so the card can SAY so rather than show a smaller number
   * with no explanation.
   */
  membershipCover?: {
    tier: string;
    insuranceMinor: number;
    postageMinor: number;
    rushMinor: number;
    addOns: Record<string, number>;
  } | null;
  coveredMinor?: number;
  totalMinor: number;
  recommended: boolean;
}

export interface Quote {
  destination: { country: string; postalCode: string };
  totalWeightGrams: number;
  boxSize: string | null;
  weightEstimated: boolean;
  itemCount: number;
  insuredValueMinor: number;
  declaredValueMinor: number;
  signatureRequired: boolean;
  needsCustoms: boolean;
  rates: QuotedRate[];
  optionProblems: { field: string; message: string; rule?: string }[];
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

const BOX_KEY: Record<string, MessageKey> = {
  rigid_mailer: 'ship.box.rigid_mailer',
  small: 'ship.box.small',
  medium: 'ship.box.medium',
  large: 'ship.box.large',
  extra_large: 'ship.box.extra_large',
};

/** A box's name, falling back to the server's English label for one this build does not know. */
export function boxLabel(t: TranslateFn, box: { key: string; label?: string }): string {
  const key = BOX_KEY[box.key];
  return key ? t(key) : (box.label ?? box.key);
}

/** "33 × 25 × 15 cm". */
export function formatBoxDimensions(box: BoxInfo): string {
  const { length, width, height } = box.dimensionsCm;
  return `${length} × ${width} × ${height} cm`;
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

/** "2 days", "2–4 days" — never "2–2 days". */
export function transitLabel(t: TranslateFn, min: number, max: number): string {
  return min === max ? t('ship.transitExact', { count: min }) : t('ship.transit', { min, max });
}

/** Grams → a readable weight. Kept here so the list and the drawer agree. */
export function formatWeight(grams: number): string {
  if (grams < 1000) return `${grams} g`;
  return `${(grams / 1000).toFixed(grams < 10_000 ? 2 : 1)} kg`;
}
