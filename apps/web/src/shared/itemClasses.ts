import type { MessageKey, TranslateFn } from './i18n';

export interface ItemClassOption {
  key: string;
  labelKey: MessageKey;
  oversized: boolean;
  lotEligible: boolean;
  lotMinSize?: number;
}

export const LOT_MIN_SIZE = 6;

export const ITEM_CLASSES: readonly ItemClassOption[] = [
  { key: 'trading_card', labelKey: 'itemClass.trading_card', oversized: false, lotEligible: true, lotMinSize: LOT_MIN_SIZE },
  { key: 'graded_slab', labelKey: 'itemClass.graded_slab', oversized: false, lotEligible: true, lotMinSize: LOT_MIN_SIZE },
  { key: 'oversized_card', labelKey: 'itemClass.oversized_card', oversized: true, lotEligible: false },
  { key: 'sealed_pack', labelKey: 'itemClass.sealed_pack', oversized: false, lotEligible: true },
  { key: 'sealed_box', labelKey: 'itemClass.sealed_box', oversized: false, lotEligible: true },
  { key: 'sealed_case', labelKey: 'itemClass.sealed_case', oversized: true, lotEligible: false },
  { key: 'collection_box', labelKey: 'itemClass.collection_box', oversized: false, lotEligible: true },
  { key: 'comic_raw', labelKey: 'itemClass.comic_raw', oversized: false, lotEligible: true },
  { key: 'comic_graded', labelKey: 'itemClass.comic_graded', oversized: false, lotEligible: true },
  { key: 'memorabilia', labelKey: 'itemClass.memorabilia', oversized: true, lotEligible: false },
  { key: 'small_collectible', labelKey: 'itemClass.small_collectible', oversized: false, lotEligible: true },
  { key: 'other', labelKey: 'itemClass.other', oversized: false, lotEligible: true },
];

const CLASS_BY_KEY = new Map(ITEM_CLASSES.map((c) => [c.key, c]));

export function itemClassOption(key: string): ItemClassOption | undefined {
  return CLASS_BY_KEY.get(key);
}

export function itemClassLabel(t: TranslateFn, key: string): string {
  const option = CLASS_BY_KEY.get(key);
  return option ? t(option.labelKey) : key;
}

export function itemName(t: TranslateFn, item: { description?: string | null; typeClass: string }): string {
  return item.description || itemClassLabel(t, item.typeClass);
}

export function itemPickText(
  t: TranslateFn,
  item: { serialNumber?: string | null; description?: string | null; typeClass: string },
): string {
  return [item.serialNumber, itemName(t, item)]
    .filter((part): part is string => Boolean(part))
    .map((part) => `\u2068${part}\u2069`)
    .join(' · ');
}

export const DISPOSAL_CATEGORIES: readonly { key: string; labelKey: MessageKey }[] = [
  { key: 'gps_tracker', labelKey: 'disposal.category.gps_tracker' },
  { key: 'lithium_battery', labelKey: 'disposal.category.lithium_battery' },
  { key: 'liquid_or_glass', labelKey: 'disposal.category.liquid_or_glass' },
  { key: 'flammable', labelKey: 'disposal.category.flammable' },
  { key: 'medical', labelKey: 'disposal.category.medical' },
  { key: 'cosmetics', labelKey: 'disposal.category.cosmetics' },
  { key: 'adult_material', labelKey: 'disposal.category.adult_material' },
  { key: 'other_prohibited', labelKey: 'disposal.category.other_prohibited' },
  { key: 'no_value', labelKey: 'disposal.category.no_value' },
];

export const DISPOSAL_OUTCOMES: readonly { key: string; labelKey: MessageKey }[] = [
  { key: 'destroyed', labelKey: 'disposal.outcome.destroyed' },
  { key: 'given_away', labelKey: 'disposal.outcome.given_away' },
  { key: 'recycled', labelKey: 'disposal.outcome.recycled' },
  { key: 'returned', labelKey: 'disposal.outcome.returned' },
];

const CATEGORY_BY_KEY = new Map(DISPOSAL_CATEGORIES.map((c) => [c.key, c]));
const OUTCOME_BY_KEY = new Map(DISPOSAL_OUTCOMES.map((c) => [c.key, c]));

export function disposalCategoryLabel(t: TranslateFn, key: string): string {
  const option = CATEGORY_BY_KEY.get(key);
  return option ? t(option.labelKey) : key;
}

export function disposalOutcomeLabel(t: TranslateFn, key: string): string {
  const option = OUTCOME_BY_KEY.get(key);
  return option ? t(option.labelKey) : key;
}

export interface ArrivalDisposal {
  id: string;
  code: string;
  category: string;
  outcome: string;
  description: string;
  notes: string;
  occurredAt: string;
  ownerUsername?: string | null;
}
