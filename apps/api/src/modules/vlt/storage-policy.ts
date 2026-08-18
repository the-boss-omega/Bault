/**
 * The storage-charge policy: what a collector gets free, and what happens after.
 *
 * The model this replaced was a flat per-item fee charged every day from the
 * second day onward. It was simple and it was wrong in one important way: it
 * charged rent on a $1 common from the moment it landed, so a collector who left
 * a bulk lot alone for six months paid many times what the lot was worth. The
 * reference service instead folds an included period into the intake fee and
 * then charges a PROPORTION of that fee per quarter, which keeps the storage
 * cost tied to the value of the handling the item actually needed.
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
 * in SQL, because it is a set operation over every stored item and belongs in the
 * database. The worker cannot import from the API tree, so this module does NOT
 * duplicate the billing calculation — it computes only what the customer-facing
 * views need to SHOW: when the included period ends, and when the next charge
 * falls. Everything about what has already been billed is READ from the charges
 * the sweep wrote, never recomputed. The sweep is the authority.
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
  percentOfIntakeBps: 10_000, // 100% — the original intake fee, again
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
 * When the next charge falls, given how many periods have already been billed.
 *
 * `periodsBilled` is COUNTED from the charges the sweep wrote, not derived from
 * the clock — so if a sweep was missed, this shows the date the catch-up will
 * cover rather than pretending it already happened.
 */
export function nextChargeAt(
  receivedAt: Date | string,
  params: StorageParameters,
  periodsBilled: number,
): Date {
  const start = freeUntil(receivedAt, params);
  return new Date(start.getTime() + periodsBilled * params.periodDays * DAY_MS);
}

/** What one period costs for an item whose intake fee was `intakeMinor`. */
export function periodChargeMinor(intakeMinor: number, params: StorageParameters): number {
  if (intakeMinor <= 0) return 0;
  return Math.round((intakeMinor * params.percentOfIntakeBps) / 10_000);
}
