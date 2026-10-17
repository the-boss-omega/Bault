/**
 * The item taxonomy, and the handling rules that ride on it.
 *
 * Three things depend on knowing WHAT a thing is, so `item.type_class` is a
 * closed vocabulary rather than free text:
 *
 *   - per-class pricing (`PricingService.price` prefers a class-specific rule
 *     over the catch-all);
 *   - the lot rule (a handful of cards is billed as individuals, not as a lot);
 *   - handling metadata, such as what is oversized.
 *
 * This module talks to nothing, so all of it is directly testable, and
 * `apps/web/src/shared/itemClasses.ts` mirrors it by value so the intake form
 * offers exactly the classes the API accepts, the same arrangement
 * `wallet-request.rules.ts` has with the SPA.
 */

export interface ItemClass {
  /** Stable key. Written to `item.type_class` and named by pricing rules. */
  key: string;
  /** English label. The SPA renders its own localised label from the key. */
  label: string;
  /**
   * Oversized items occupy shelf space out of proportion to their value. The
   * flag fixes the item's storage terms at intake, steers it to oversized
   * shelving, and keeps it out of the boxes too small for it.
   */
  oversized: boolean;
  /**
   * Whether this class may be received as a LOT at all. A lot is stored and
   * billed as one item until it is broken, which only makes sense for things
   * that genuinely arrive in bulk. A single graded slab is never "a lot".
   */
  lotEligible: boolean;
  /**
   * The smallest number of pieces that is a lot for THIS class. Absent means
   * any size counts.
   *
   * Only cards carry one, deliberately. The rule is a card rule (a handful of
   * loose cards is cheaper and more useful to the collector as individual
   * records) and it does not generalise: splitting four sealed boxes into four
   * separate intakes would quadruple the fee for no benefit to anybody.
   */
  lotMinSize?: number;
  /**
   * What one of these typically weighs, in grams, packed for shipping.
   *
   * This is the FALLBACK. An operator who weighs something at intake records the
   * real figure on the item and it is used instead; this is what stands in when
   * nobody did, and it is per-class because a class is the one thing always
   * known about an item.
   */
  typicalWeightGrams: number;
}

/**
 * The card-lot threshold. A "lot" of five or fewer CARDS is not a lot: each is
 * received as its own item, with its own serial, barcode and intake charge.
 *
 * This is a BILLING rule wearing handling clothes. Below the threshold the
 * difference between one lot fee and N individual fees is large in proportion to
 * the value involved, and the individual records are what the collector actually
 * wants: they cannot sell, grade or ship one card out of an unbroken lot.
 */
export const LOT_MIN_SIZE = 6;

/**
 * The accepted classes.
 *
 * Deliberately coarse. Each entry has to earn its place by changing how the item
 * is handled, stored or priced; every extra option is another chance for two
 * operators to file the same object differently.
 */
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

/**
 * Whether a lot of this size, in this class, is a lot at all, or a handful of
 * individual items wearing the word.
 *
 * A class with no `lotMinSize` has no threshold and any size qualifies.
 */
export function qualifiesAsLot(cls: ItemClass, size: number): boolean {
  return cls.lotMinSize === undefined || size >= cls.lotMinSize;
}

/**
 * What to tell a carrier this item weighs.
 *
 * A recorded weight always wins: somebody put it on a scale. Otherwise the
 * class's typical weight stands in, multiplied by the lot size, because an
 * unbroken lot of forty cards is forty cards in one parcel and weighing it as
 * one card would under-declare the parcel by a factor of forty.
 */
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

/* ============================================================
   Things Bault does not accept
   ============================================================ */

/**
 * Why an arrival was not put into a vault.
 *
 * These are the categories an operator picks from when something turns up that
 * cannot be stored. They are NOT item classes: nothing here ever becomes an
 * item, which is exactly what distinguishes them.
 *
 * The list is short and closed on purpose. `other_prohibited` exists because a
 * warehouse meets things no list anticipated, and forcing one of those into a
 * wrong category would make the record less true than an honest "other" plus the
 * mandatory note.
 */
export interface DisposalCategory {
  key: string;
  label: string;
  /** True when the category is a safety/legal refusal rather than a judgement. */
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
  /**
   * A judgement about value: processing costs more than the thing is worth, so
   * it is given away or recycled instead of being shelved and billed.
   */
  { key: 'no_value', label: 'No processing value', prohibited: false },
];

const CATEGORY_BY_KEY = new Map(DISPOSAL_CATEGORIES.map((c) => [c.key, c]));

export function disposalCategory(key: string): DisposalCategory | undefined {
  return CATEGORY_BY_KEY.get(key);
}

export function isKnownDisposalCategory(key: string): boolean {
  return CATEGORY_BY_KEY.has(key);
}

/**
 * What physically happened to it.
 *
 * The software does not perform any of these; a person does. What the software
 * owes is a truthful record of which one occurred, because the collector is
 * entitled to know that something addressed to them arrived and did not survive.
 */
export const DISPOSAL_OUTCOMES = ['destroyed', 'given_away', 'recycled', 'returned'] as const;
export type DisposalOutcome = (typeof DISPOSAL_OUTCOMES)[number];

export function isKnownDisposalOutcome(value: string): value is DisposalOutcome {
  return (DISPOSAL_OUTCOMES as readonly string[]).includes(value);
}
