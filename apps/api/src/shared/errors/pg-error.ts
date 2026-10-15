/**
 * The Postgres SQLSTATE behind an error, wherever the driver stack put it.
 *
 * drizzle-orm 0.45 wraps every failed query in a `DrizzleQueryError` and keeps
 * the pg error as its `cause`, so `err.code` on what a query throws is
 * undefined. Code that branched on `err.code === '23505'` would silently stop
 * recognising a unique violation and let it surface as a 500. Every branch on a
 * database error code goes through this instead of reading `.code` directly.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    // SQLSTATEs are five characters; Node's own codes (ECONNREFUSED, ...) are not.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
