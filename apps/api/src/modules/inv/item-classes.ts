export interface ItemClass {
  key: string;
  label: string;
  oversized: boolean;
  lotEligible: boolean;
  lotMinSize?: number;
  typicalWeightGrams: number;
}

export const LOT_MIN_SIZE = 6;

export const ITEM_CLASSES: readonly ItemClass[] = [
  { key: 'trading_card', label: 'Trading card', oversized: false, lotEligible: true, lotMinSize: LOT_MIN_SIZE, typicalWeightGrams: 5 },
  { key: 'graded_slab', label: 'Graded slab', oversized: false, lotEligible: true, lotMinSize: LOT_MIN_SIZE, typicalWeightGrams: 60 },
  { key: 'oversized_card', label: 'Oversized card', oversized: true, lotEligible: false, typicalWeightGrams: 40 },
  { key: 'sealed_pack', label: 'Sealed pack', oversized: false, lotEligible: true, typicalWeightGrams: 30 },
  { key: 'sealed_box', label: 'Sealed box', oversized: false, lotEligible: true, typicalWeightGrams: 500 },
  { key: 'sealed_case', label: 'Sealed case', oversized: true, lotEligible: false, typicalWeightGrams: 6000 },
  { key: 'collection_box', label: 'Collection box', oversized: false, lotEligible: true, typicalWeightGrams: 1200 },
  { key: 'comic_raw', label: 'Comic book (raw)', oversized: false, lotEligible: true, typicalWeightGrams: 90 },
  { key: 'comic_graded', label: 'Comic book (graded)', oversized: false, lotEligible: true, typicalWeightGrams: 350 },
  { key: 'memorabilia', label: 'Memorabilia', oversized: true, lotEligible: false, typicalWeightGrams: 2000 },
  { key: 'small_collectible', label: 'Small collectible', oversized: false, lotEligible: true, typicalWeightGrams: 250 },
  { key: 'other', label: 'Other', oversized: false, lotEligible: true, typicalWeightGrams: 400 },
];

const BY_KEY = new Map(ITEM_CLASSES.map((c) => [c.key, c]));

export function itemClass(key: string): ItemClass | undefined {
  return BY_KEY.get(key);
}

export function isKnownItemClass(key: string): boolean {
  return BY_KEY.has(key);
}

export function qualifiesAsLot(cls: ItemClass, size: number): boolean {
  return cls.lotMinSize === undefined || size >= cls.lotMinSize;
}

export function itemWeightGrams(it: {
  typeClass: string;
  weightGrams?: number | null;
  isLot?: boolean | null;
  lotSize?: number | null;
}): number {
  if (typeof it.weightGrams === 'number' && it.weightGrams > 0) return it.weightGrams;
  const cls = itemClass(it.typeClass);
  const each = cls?.typicalWeightGrams ?? 400;
  const count = it.isLot && it.lotSize && it.lotSize > 0 ? it.lotSize : 1;
  return each * count;
}

export interface DisposalCategory {
  key: string;
  label: string;
  prohibited: boolean;
}

export const DISPOSAL_CATEGORIES: readonly DisposalCategory[] = [
  { key: 'gps_tracker', label: 'GPS tracker', prohibited: true },
  { key: 'lithium_battery', label: 'Lithium battery', prohibited: true },
  { key: 'liquid_or_glass', label: 'Liquid or glass', prohibited: true },
  { key: 'flammable', label: 'Flammable item', prohibited: true },
  { key: 'medical', label: 'Drugs, medicine or supplements', prohibited: true },
  { key: 'cosmetics', label: 'Cosmetics or perfume', prohibited: true },
  { key: 'adult_material', label: 'Adult material', prohibited: true },
  { key: 'other_prohibited', label: 'Other prohibited item', prohibited: true },
  { key: 'no_value', label: 'No processing value', prohibited: false },
];

const CATEGORY_BY_KEY = new Map(DISPOSAL_CATEGORIES.map((c) => [c.key, c]));

export function disposalCategory(key: string): DisposalCategory | undefined {
  return CATEGORY_BY_KEY.get(key);
}

export function isKnownDisposalCategory(key: string): boolean {
  return CATEGORY_BY_KEY.has(key);
}

export const DISPOSAL_OUTCOMES = ['destroyed', 'given_away', 'recycled', 'returned'] as const;
export type DisposalOutcome = (typeof DISPOSAL_OUTCOMES)[number];

export function isKnownDisposalOutcome(value: string): value is DisposalOutcome {
  return (DISPOSAL_OUTCOMES as readonly string[]).includes(value);
}
