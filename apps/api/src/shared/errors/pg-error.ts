export const PG_UNIQUE_VIOLATION = '23505';

function pgErrorOf(error: unknown): { code: string; constraint?: unknown } | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return current as { code: string; constraint?: unknown };
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function pgErrorCode(error: unknown): string | undefined {
  return pgErrorOf(error)?.code;
}

export function pgConstraint(error: unknown): string | undefined {
  const constraint = pgErrorOf(error)?.constraint;
  return typeof constraint === 'string' && constraint ? constraint : undefined;
}

export function isUniqueViolationOf(error: unknown, constraint: string): boolean {
  return pgErrorCode(error) === PG_UNIQUE_VIOLATION && pgConstraint(error) === constraint;
}
