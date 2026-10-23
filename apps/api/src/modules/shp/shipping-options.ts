import { formatMinor } from '../../shared/money';

export const MAX_INSURED_VALUE_MINOR = 500_000;

export const SIGNATURE_REQUIRED_ABOVE_MINOR = 50_000;

export const INSURANCE_PREMIUM_BPS = 150;

export const INSURANCE_MINIMUM_PREMIUM_MINOR = 200;

export function insurancePremiumMinor(insuredValueMinor: number): number {
  if (insuredValueMinor <= 0) return 0;
  const premium = Math.ceil((insuredValueMinor * INSURANCE_PREMIUM_BPS) / 10_000);
  return Math.max(premium, INSURANCE_MINIMUM_PREMIUM_MINOR);
}

export function signatureForced(insuredValueMinor: number): boolean {
  return insuredValueMinor > SIGNATURE_REQUIRED_ABOVE_MINOR;
}

export interface ShipmentAddOn {
  key: string;
  label: string;
  priceMinor: number;
  requiresInsuranceMinor: number;
  description: string;
}

export const SHIPMENT_ADD_ONS: readonly ShipmentAddOn[] = [
  {
    key: 'gps_tracker',
    label: 'GPS tracker in the parcel',
    priceMinor: 3_000,
    requiresInsuranceMinor: 50_000,
    description:
      'A tracker travels inside the parcel and is handed over to your Apple ID once it is delivered.',
  },
];

const ADD_ON_BY_KEY = new Map(SHIPMENT_ADD_ONS.map((a) => [a.key, a]));

export function shipmentAddOn(key: string): ShipmentAddOn | undefined {
  return ADD_ON_BY_KEY.get(key);
}

export function addOnFeeAction(key: string): string {
  return `shipping_addon:${key}`;
}

export const RESTOCKING_FEE_MINOR = 2_500;

export const PAYMENT_WINDOW_DAYS = 7;

export function needsCustoms(destinationCountry: string): boolean {
  return destinationCountry.toUpperCase() !== 'US';
}

export const DEFAULT_HS_CODE = '4911.99';

export const DEFAULT_COUNTRY_OF_ORIGIN = 'US';

export const CUSTOMS_CONTENTS_TYPE = 'merchandise' as const;

export const CUSTOMS_NON_DELIVERY = 'return' as const;

export interface ShipmentOptionProblem {
  field: string;
  message: string;
}

export function checkOptions(opts: {
  insuredValueMinor: number;
  signatureRequired: boolean;
  customsValueMinor: number;
  destinationCountry: string;
  addOns: string[];
}): ShipmentOptionProblem[] {
  const problems: ShipmentOptionProblem[] = [];

  if (opts.insuredValueMinor < 0) {
    problems.push({ field: 'insuredValueMinor', message: 'Insured value cannot be negative.' });
  }
  if (opts.insuredValueMinor > MAX_INSURED_VALUE_MINOR) {
    problems.push({
      field: 'insuredValueMinor',
      message: `Cover stops at ${formatMinor(MAX_INSURED_VALUE_MINOR)} on one parcel. Split it across two.`,
    });
  }
  if (signatureForced(opts.insuredValueMinor) && !opts.signatureRequired) {
    problems.push({
      field: 'signatureRequired',
      message: `Anything insured above ${formatMinor(SIGNATURE_REQUIRED_ABOVE_MINOR)} has to be signed for.`,
    });
  }
  if (needsCustoms(opts.destinationCountry) && opts.customsValueMinor <= 0) {
    problems.push({
      field: 'customsValueMinor',
      message: 'An international parcel needs a customs value. We will not declare a figure you did not give us.',
    });
  }
  for (const key of opts.addOns) {
    const addOn = shipmentAddOn(key);
    if (!addOn) {
      problems.push({ field: 'addOns', message: `Unknown add-on "${key}".` });
      continue;
    }
    if (opts.insuredValueMinor < addOn.requiresInsuranceMinor) {
      problems.push({
        field: 'addOns',
        message: `${addOn.label} needs at least ${formatMinor(addOn.requiresInsuranceMinor)} of insurance.`,
      });
    }
  }
  return problems;
}
