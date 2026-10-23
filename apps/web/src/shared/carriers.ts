import type { MessageKey, TranslateFn } from './i18n';

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
}

export interface RateProblem {
  rule: string;
  message: string;
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

export function boxLabel(t: TranslateFn, box: { key: string; label?: string }): string {
  const key = BOX_KEY[box.key];
  return key ? t(key) : (box.label ?? box.key);
}

export function formatBoxDimensions(box: BoxInfo): string {
  const { length, width, height } = box.dimensionsCm;
  return `${length} × ${width} × ${height} cm`;
}

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

export function formatWeight(grams: number): string {
  if (grams < 1000) return `${grams} g`;
  return `${(grams / 1000).toFixed(grams < 10_000 ? 2 : 1)} kg`;
}
