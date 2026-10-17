/**
 * The storage-charge policy: what a collector gets free, and what happens after.
 *
 * An included period is folded into the intake fee, and after it a PROPORTION
 * of that fee is charged per period, so storage cost stays tied to the handling
 * the item needed and a $1 common does not pay rent from the day it lands.
 *
 * Two parameter sets, one mechanism:
 *
 *   standard    180 days included, then 10% of the item's own intake fee every
 *               90 days.
 *   oversized   90 days included, then 100% of the intake fee every 90 days.
 *               Deliberately punitive: an oversized item occupies shelf space
 *               out of all proportion to its value, and the charge exists to
 *               make "leave it there forever" a decision rather than a default.
 *
 * Both come from the `parameters` column of the relevant pricing rule, so they
 * are admin-editable data rather than constants (Principle VI). The defaults
 * below apply only when a rule omits them.
 *
 * WHERE THIS RULE LIVES. Billing is performed by the worker's storage-fee sweep,
 * in SQL, because it is a set operation over every stored item. The worker
 * cannot import from the API tree, so this module does NOT duplicate the billing
 * calculation. It computes only what the customer-facing views need to SHOW:
 * when the included period ends, when the next charge falls, and what one period
 * costs. What has already been billed is READ from the charges the sweep wrote,
 * never recomputed. The sweep is the authority.
 */

export interface StorageParameters {
  /** Days of storage included in the intake fee. */
  freeDays: number;
  /** Length of each chargeable period after that. */
  periodDays: number;
  /** Charge per period, as basis points of the item's own intake fee. */
  percentOfIntakeBps: number;
}

export const STANDARD_STORAGE: StorageParameters = {
  freeDays: 180,
  periodDays: 90,
  percentOfIntakeBps: 1_000, // 10%
};

export const OVERSIZED_STORAGE: StorageParameters = {
  freeDays: 90,
  periodDays: 90,
  percentOfIntakeBps: 10_000, // 100%: the original intake fee, again
};

/**
 * Read the parameters off a pricing rule, falling back to the defaults for
 * anything the rule does not state.
 *
 * A rule with a malformed `parameters` blob falls back rather than throwing: the
 * alternative is a vault page that fails to render because somebody typed a bad
 * value into an admin form, and the numbers here are informational.
 */
export function storageParameters(
  raw: unknown,
  fallback: StorageParameters = STANDARD_STORAGE,
): StorageParameters {
  const p = (raw ?? {}) as Record<string, unknown>;
  const num = (value: unknown, dflt: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : dflt;
  return {
    freeDays: num(p.freeDays, fallback.freeDays),
    periodDays: Math.max(1, num(p.periodDays, fallback.periodDays)),
    percentOfIntakeBps: num(p.percentOfIntakeBps, fallback.percentOfIntakeBps),
  };
}

const DAY_MS = 86_400_000;

/** The moment the included period ends and storage starts costing money. */
export function freeUntil(receivedAt: Date | string, params: StorageParameters): Date {
  const from = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  return new Date(from.getTime() + params.freeDays * DAY_MS);
}

/**
 * When the next charge falls, the way the sweep counts it.
 *
 * The chargeable clock starts at the end of the included period or at the
 * last membership cover (`storage_cover.covered_until`), whichever is later,
 * and `periodsBilled` counts the storage charges since that cover. Counted
 * from `receivedAt` alone, an item that had been covered was dated from the
 * day it arrived, often a date already past.
 *
 * `periodsBilled` is COUNTED from the charges the sweep wrote, not derived from
 * the clock, so if a sweep was missed, this shows the date the catch-up will
 * cover rather than pretending it already happened.
 */
export function nextChargeAt(
  receivedAt: Date | string,
  params: StorageParameters,
  periodsBilled: number,
  coveredUntil: Date | string | null = null,
): Date {
  const included = freeUntil(receivedAt, params).getTime();
  const cover = coveredUntil ? new Date(coveredUntil).getTime() : -Infinity;
  return new Date(Math.max(included, cover) + periodsBilled * params.periodDays * DAY_MS);
}

/**
 * What one period costs for an item whose intake fee was `intakeMinor`.
 *
 * Never under a cent, as the sweep bills it (`GREATEST(1, ...)`): a period
 * that rounds to nothing is still a period charged.
 */
export function periodChargeMinor(intakeMinor: number, params: StorageParameters): number {
  return Math.max(1, Math.round((intakeMinor * params.percentOfIntakeBps) / 10_000));
}
