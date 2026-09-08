/**
 * The SPA's copy of the person-name and username rules.
 *
 * Deliberately a copy, not an import: the web app carries no build dependency on
 * the API package, and vice versa. The API's version lives in
 * `apps/api/src/shared/names.ts` and the two are matched BY VALUE — the same
 * limits, the same normalization, the same validity test — and covered by the
 * same cases in `tests/web/names.test.ts`, so a drift shows up as a failing test
 * rather than as a form that accepts what the server then rejects.
 *
 * There is no display name here, and no function that produces one for storage.
 * A full name is DERIVED with `fullName()` at the moment it is rendered, so it
 * can never disagree with the two fields it comes from.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_PATTERN = /^[a-z0-9_.-]+$/;
export const NAME_PART_MAX = 80;
/**
 * Shortest password the API will accept (`@MinLength(8)` on every password DTO).
 *
 * Named here because three separate forms — sign-up, reset, change — each hard
 * coded the literal 8 next to a hint that spelled the number out in prose, so
 * the rule and the sentence describing it could drift apart without anything
 * noticing.
 */
export const PASSWORD_MIN = 8;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(normalized: string): boolean {
  return (
    normalized.length >= USERNAME_MIN &&
    normalized.length <= USERNAME_MAX &&
    USERNAME_PATTERN.test(normalized)
  );
}

/** Collapse internal whitespace and trim; applied to both name parts. */
export function normalizeNamePart(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Highest code point treated as a control character (U+0000–U+001F). */
const LAST_CONTROL_CODE_POINT = 0x1f;

/**
 * Whether a NORMALIZED name part is acceptable.
 *
 * Permissive about the alphabet — Hebrew, Arabic, accents, apostrophes and
 * hyphens are all real parts of real names — and strict only about emptiness,
 * length, and characters that would let a name masquerade as markup or smuggle
 * a line break into a shipping label.
 *
 * The control-character test walks code points rather than using a regex range,
 * so this source file contains no control characters of its own.
 */
export function isValidNamePart(normalized: string): boolean {
  if (normalized.length === 0 || normalized.length > NAME_PART_MAX) return false;
  if (normalized.includes('<') || normalized.includes('>')) return false;
  for (const character of normalized) {
    if ((character.codePointAt(0) ?? 0) <= LAST_CONTROL_CODE_POINT) return false;
  }
  return true;
}

/**
 * The one way a full name is produced in the SPA. Never stored.
 *
 * Returns '' when neither part is present, which callers render as a fallback
 * (the username, or the email) rather than as an empty cell.
 */
export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first ?? '', last ?? ''].map((part) => part.trim()).filter(Boolean).join(' ');
}

/**
 * Up to two initials for the avatar: from the name parts when they exist, and
 * from the email's local part when they do not. Never empty — falls back to the
 * product's own mark so the avatar is never a blank circle.
 */
export function initialsFrom(
  first: string | null | undefined,
  last: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const parts = [first, last].map((part) => (part ?? '').trim()).filter(Boolean);
  if (parts.length > 0) {
    return parts
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase();
  }
  const source = (fallback ?? '').replace(/@.*$/, '');
  const initials = source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
  return initials || 'BA';
}
