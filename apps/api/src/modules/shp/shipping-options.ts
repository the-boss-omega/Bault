/**
 * Everything a collector can put ON a shipment, and the rules between them.
 *
 * A Bault shipment carried items, an address, a recipient, a rush flag and a
 * carrier. Nothing about what the parcel was WORTH, whether anybody would cover
 * it if it vanished, or whether a human had to be there to receive it — which,
 * for a vault whose customers are by definition the people with valuable cards,
 * is the most conspicuous absence in the outbound half of the product.
 *
 * The rules here are the interesting part, because they constrain each other:
 * insuring past a threshold FORCES a signature (an insurer will not cover a
 * parcel left on a doorstep), and a tracker add-on is only sold alongside
 * insurance (it exists to help recover a parcel somebody is going to claim on).
 */
import { formatMinor } from '../../shared/money';

/* ============================================================
   Insurance
   ============================================================ */

/** The most Bault's third-party cover will insure on one parcel. */
export const MAX_INSURED_VALUE_MINOR = 500_000; // $5,000

/**
 * Above this, the carrier must collect a signature.
 *
 * Not a Bault preference — it is the condition on which the cover is written. A
 * parcel worth more than this left on a doorstep is not insured, so offering the
 * combination would be selling somebody a policy that would not pay.
 */
export const SIGNATURE_REQUIRED_ABOVE_MINOR = 50_000; // $500

/**
 * The premium, in basis points of the insured value.
 *
 * A flat rate rather than a band table: bands invite arguing about the edges,
 * and the difference over the range Bault actually insures is pennies.
 */
export const INSURANCE_PREMIUM_BPS = 150; // 1.50%

/** The smallest premium worth writing a policy for. */
export const INSURANCE_MINIMUM_PREMIUM_MINOR = 200; // $2.00

export function insurancePremiumMinor(insuredValueMinor: number): number {
  if (insuredValueMinor <= 0) return 0;
  const premium = Math.ceil((insuredValueMinor * INSURANCE_PREMIUM_BPS) / 10_000);
  return Math.max(premium, INSURANCE_MINIMUM_PREMIUM_MINOR);
}

/** Whether this insured value obliges a signature. */
export function signatureForced(insuredValueMinor: number): boolean {
  return insuredValueMinor > SIGNATURE_REQUIRED_ABOVE_MINOR;
}

/* ============================================================
   Add-ons
   ============================================================ */

export interface ShipmentAddOn {
  key: string;
  label: string;
  priceMinor: number;
  /** Only sold when the parcel is insured for at least this much. */
  requiresInsuranceMinor: number;
  description: string;
}

export const SHIPMENT_ADD_ONS: readonly ShipmentAddOn[] = [
  {
    key: 'gps_tracker',
    label: 'GPS tracker in the parcel',
    priceMinor: 3_000, // $30
    requiresInsuranceMinor: 50_000, // $500
    description:
      'A tracker travels inside the parcel and is handed over to your Apple ID once it is delivered.',
  },
];

const ADD_ON_BY_KEY = new Map(SHIPMENT_ADD_ONS.map((a) => [a.key, a]));

export function shipmentAddOn(key: string): ShipmentAddOn | undefined {
  return ADD_ON_BY_KEY.get(key);
}

/** The pricing-rule action type carrying an add-on's price. */
export function addOnFeeAction(key: string): string {
  return `shipping_addon:${key}`;
}

/* ============================================================
   Cancelling, and not paying
   ============================================================ */

/**
 * What cancelling costs once a request exists.
 *
 * It is not a penalty for changing your mind — it is the double verification and
 * the packing that were already done. Which is exactly why it is charged only
 * once a rate has been selected: a request nobody has touched yet costs nothing
 * to abandon, and charging for that would be charging for nothing.
 */
export const RESTOCKING_FEE_MINOR = 2_500; // $25

/** How long an unpaid shipment is held before its items go back on the shelf. */
export const PAYMENT_WINDOW_DAYS = 7;

/* ============================================================
   How much a parcel is presumed to be worth
   ============================================================ */

/**
 * Whether this destination needs customs paperwork at all.
 *
 * Everything Bault ships leaves from the United States, so "international" and
 * "needs a customs declaration" are the same question.
 */
export function needsCustoms(destinationCountry: string): boolean {
  return destinationCountry.toUpperCase() !== 'US';
}

/**
 * The HS heading for collectible trading cards.
 *
 * Printed matter, other — which is what a customs broker will tell you, and what
 * every collectibles forwarder declares. It is carried on the commercial invoice
 * because a parcel that arrives without one is a parcel sitting in a bonded
 * warehouse while somebody emails about it.
 */
export const DEFAULT_HS_CODE = '4911.99';

/** Where the goods were made, as far as a customs form is concerned. */
export const DEFAULT_COUNTRY_OF_ORIGIN = 'US';

export interface ShipmentOptionProblem {
  field: string;
  message: string;
}

/**
 * Check the options against each other, before anything is priced.
 *
 * This is the courtesy layer that mirrors the server's own rules, and it is the
 * server's own rules — both the create and the edit path call it, so there is
 * exactly one place that decides whether a combination is legal.
 */
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
