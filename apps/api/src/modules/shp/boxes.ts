/**
 * The boxes a parcel can go out in.
 *
 * Until this existed every quote priced the contents plus a flat 120 g of
 * "packaging" and nothing else — so a single card in a rigid mailer and a
 * shoebox of sleeved commons with the same weight were the same parcel to every
 * carrier, and the second one was under-quoted by whatever its volume was worth.
 * `dimensionsCm` was wired through the carrier catalogue and both adapters and
 * nothing ever filled it in.
 *
 * A box brings the two numbers a carrier actually prices on and a weight did not:
 * its OUTER dimensions, which drive dimensional weight, and its own weight, which
 * replaces the flat 120 g. Choosing none keeps the old behaviour — priced on
 * weight, the warehouse picks the box — because a collector who does not know or
 * care should not be made to guess.
 *
 * The limits are the courtesy layer, not a packing algorithm. Bault does not know
 * the dimensions of what is on its shelves, only the class and the weight, so the
 * rules are the two it can state honestly: a box refuses more weight than it is
 * rated for, and the flat mailer and the small box refuse the things that
 * physically cannot go in them.
 */
import { itemClass } from '../inv/item-classes';

export interface ShippingBox {
  key: string;
  label: string;
  /** Outer dimensions — what the carrier measures, not what fits inside. */
  dimensionsCm: { length: number; width: number; height: number };
  /** The box and its padding. Replaces the flat packaging allowance. */
  tareGrams: number;
  /** The most it is rated to carry. */
  maxContentsGrams: number;
  /** When set, only these item classes fit at all. */
  onlyClasses?: readonly string[];
  /** Whether an oversized item (a sealed case, a framed piece) can go in it. */
  takesOversized: boolean;
}

export const SHIPPING_BOXES: readonly ShippingBox[] = [
  {
    key: 'rigid_mailer',
    label: 'Rigid mailer',
    dimensionsCm: { length: 25, width: 18, height: 3 },
    tareGrams: 60,
    maxContentsGrams: 500,
    onlyClasses: ['trading_card', 'graded_slab', 'sealed_pack'],
    takesOversized: false,
  },
  {
    key: 'small',
    label: 'Small box',
    dimensionsCm: { length: 23, width: 18, height: 10 },
    tareGrams: 180,
    maxContentsGrams: 2_000,
    takesOversized: false,
  },
  {
    key: 'medium',
    label: 'Medium box',
    dimensionsCm: { length: 33, width: 25, height: 15 },
    tareGrams: 320,
    maxContentsGrams: 6_000,
    takesOversized: true,
  },
  {
    key: 'large',
    label: 'Large box',
    dimensionsCm: { length: 45, width: 35, height: 25 },
    tareGrams: 600,
    maxContentsGrams: 15_000,
    takesOversized: true,
  },
  {
    key: 'extra_large',
    label: 'Extra-large box',
    dimensionsCm: { length: 60, width: 45, height: 40 },
    tareGrams: 1_000,
    maxContentsGrams: 30_000,
    takesOversized: true,
  },
];

export const SHIPPING_BOX_KEYS = SHIPPING_BOXES.map((b) => b.key);

const BY_KEY = new Map(SHIPPING_BOXES.map((b) => [b.key, b]));

export function shippingBox(key: string | null | undefined): ShippingBox | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

export interface BoxProblem {
  field: 'boxSize';
  /** So the SPA can phrase it without parsing English. */
  rule: 'box_weight' | 'box_contents';
  message: string;
}

/**
 * Whether the parcel fits the box that was chosen.
 *
 * Returned in the same shape as `checkOptions`, and for the same reason: a quote
 * shows it next to the prices, and create and edit refuse on it.
 */
export function checkBox(
  box: ShippingBox | undefined,
  contents: { totalWeightGrams: number; typeClasses: string[] },
): BoxProblem[] {
  if (!box) return [];
  const problems: BoxProblem[] = [];

  if (contents.totalWeightGrams > box.maxContentsGrams) {
    problems.push({
      field: 'boxSize',
      rule: 'box_weight',
      message: `A ${box.label.toLowerCase()} carries up to ${(box.maxContentsGrams / 1000).toFixed(1)} kg. Choose a bigger box.`,
    });
  }

  const misfit = contents.typeClasses.find(
    (c) =>
      (box.onlyClasses !== undefined && !box.onlyClasses.includes(c)) ||
      (!box.takesOversized && itemClass(c)?.oversized === true),
  );
  if (misfit !== undefined) {
    problems.push({
      field: 'boxSize',
      rule: 'box_contents',
      message: `A ${itemClass(misfit)?.label.toLowerCase() ?? misfit} does not fit in a ${box.label.toLowerCase()}. Choose a bigger box.`,
    });
  }
  return problems;
}
