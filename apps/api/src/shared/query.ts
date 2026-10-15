import { AppError } from './errors/app-error';

/**
 * A page size taken from a query string, validated and capped.
 *
 * `Number(raw)` was all there was, and the results reached drizzle as they came:
 * `?limit=abc` is NaN, `?limit=-1` is negative, and drizzle 0.38 drops a LIMIT
 * that is not a non-negative number rather than sending it — so either one
 * turned a capped list into the whole table. On the public listing route that
 * handed a guest every active listing, with a signed image URL minted for each.
 *
 * Absent (or empty) means the caller's default. Anything that is not a whole
 * number of at least one is refused; anything above `max` is capped to it,
 * which is what a client asking for "everything" should get.
 */
export function pageLimit(raw: unknown, opts: { max: number; fallback: number }): number {
  if (raw === undefined || raw === '') return opts.fallback;
  if (typeof raw !== 'string' || !/^[0-9]{1,9}$/.test(raw)) {
    throw AppError.validation('limit must be a whole number of at least 1', { field: 'limit' });
  }
  const n = Number(raw);
  if (n < 1) throw AppError.validation('limit must be a whole number of at least 1', { field: 'limit' });
  return Math.min(n, opts.max);
}

/**
 * The same cap, for a limit that arrives as a number from inside the API.
 *
 * Defence in depth for the services the controllers call: whatever reaches the
 * query is a whole number between 1 and `max`, so no caller can drop the LIMIT
 * by handing over NaN.
 */
export function clampLimit(n: number | undefined, opts: { max: number; fallback: number }): number {
  if (n === undefined || !Number.isFinite(n)) return opts.fallback;
  return Math.min(Math.max(1, Math.trunc(n)), opts.max);
}
