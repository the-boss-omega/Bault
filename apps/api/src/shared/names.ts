/**
 * The person-name and username rules, in one place.
 *
 * Two identifiers describe an account to a human:
 *
 *  - the **username**, which is the permanent, unique, customer-facing handle
 *    used everywhere a shipment, an intake or an audit line has to say *whose*
 *    it is. It is normalized once (trimmed + lower-cased) on the way in, so
 *    "Red", " red " and "RED" can never become three different accounts;
 *  - the **person name**, which is now two explicit columns, `first_name` and
 *    `last_name`. There is deliberately no third, independently editable
 *    "display name" column that could drift out of step with them — anywhere the
 *    UI needs a full name it derives one with `fullName()`.
 *
 * The API and the SPA each keep their own copy of these rules (the SPA's lives
 * in `apps/web/src/shared/names.ts`) so neither carries a build dependency on
 * the other; they are matched by value and covered by the same test cases.
 */

/** Length and character rules for a username; mirrored by RegisterDto. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_PATTERN = /^[a-z0-9_.-]+$/;

/**
 * The single normalization applied to every username, at every entry point.
 *
 * Registration writes the normalized form, and sign-in normalizes the
 * identifier before looking it up, so the unique index on `username` is an
 * index over exactly the values users can type.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Whether a NORMALIZED username is acceptable. Callers normalize first. */
export function isValidUsername(normalized: string): boolean {
  return (
    normalized.length >= USERNAME_MIN &&
    normalized.length <= USERNAME_MAX &&
    USERNAME_PATTERN.test(normalized)
  );
}

/** Collapse internal whitespace and trim; used for both name parts. */
export function normalizeNamePart(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export const NAME_PART_MAX = 80;

/**
 * Whether a name part is acceptable.
 *
 * Deliberately permissive about the alphabet — Hebrew, Arabic, accents,
 * apostrophes and hyphens are all real parts of real names — and strict only
 * about emptiness, length, and characters that would let a name masquerade as
 * markup or a control code.
 */
export function isValidNamePart(normalized: string): boolean {
  if (normalized.length === 0 || normalized.length > NAME_PART_MAX) return false;
  // eslint-disable-next-line no-control-regex
  return !/[<>\u0000-\u001f]/.test(normalized);
}

/**
 * The one way a full name is produced. Never stored — always derived, so it can
 * never disagree with the two columns it comes from.
 */
export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first ?? '', last ?? ''].map((p) => p.trim()).filter(Boolean).join(' ');
}

/** What the legacy `display_name` migration decided about one account. */
export interface LegacyNameSplit {
  firstName: string | null;
  lastName: string | null;
  /** True when the split is a guess a human should confirm. */
  reviewRequired: boolean;
}

/**
 * The documented migration rule for a legacy single-string display name.
 *
 * Exactly two whitespace-separated words split cleanly into first + last and
 * need no review — that is the only case where the boundary is unambiguous.
 * EVERY other shape (empty, one word, three or more words, or a name that
 * clearly carries a particle like "van der") keeps the whole string as the first
 * name and is FLAGGED, because inventing a boundary would silently corrupt the
 * record. Nothing is dropped and no account loses access either way.
 *
 * The same rule is implemented in SQL in migration 0004 so the database and the
 * application agree; this function is what the tests pin the rule to.
 */
export function splitLegacyDisplayName(displayName: string | null | undefined): LegacyNameSplit {
  const cleaned = normalizeNamePart(displayName ?? '');
  if (cleaned === '') return { firstName: null, lastName: null, reviewRequired: true };

  const words = cleaned.split(' ');
  if (words.length === 2) {
    return { firstName: words[0] ?? null, lastName: words[1] ?? null, reviewRequired: false };
  }
  return { firstName: cleaned.slice(0, NAME_PART_MAX), lastName: null, reviewRequired: true };
}
