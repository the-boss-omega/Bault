import { itemClass } from '../inv/item-classes';

export interface ShippingBox {
  key: string;
  label: string;
  dimensionsCm: { length: number; width: number; height: number };
  tareGrams: number;
  maxContentsGrams: number;
  onlyClasses?: readonly string[];
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

function volumeCm3(box: ShippingBox): number {
  return box.dimensionsCm.length * box.dimensionsCm.width * box.dimensionsCm.height;
}

const BY_VOLUME = [...SHIPPING_BOXES].sort((a, b) => volumeCm3(a) - volumeCm3(b));

export function chooseBox(contents: {
  totalWeightGrams: number;
  typeClasses: string[];
}): ShippingBox | undefined {
  return BY_VOLUME.find((box) => checkBox(box, contents).length === 0);
}

export interface BoxProblem {
  field: 'boxSize';
  rule: 'box_weight' | 'box_contents';
  message: string;
}

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
