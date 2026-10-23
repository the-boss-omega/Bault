export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_PATTERN = /^[a-z0-9_.-]+$/;
export const NAME_PART_MAX = 80;
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

export function normalizeNamePart(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

const LAST_CONTROL_CODE_POINT = 0x1f;

export function isValidNamePart(normalized: string): boolean {
  if (normalized.length === 0 || normalized.length > NAME_PART_MAX) return false;
  if (normalized.includes('<') || normalized.includes('>')) return false;
  for (const character of normalized) {
    if ((character.codePointAt(0) ?? 0) <= LAST_CONTROL_CODE_POINT) return false;
  }
  return true;
}

export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first ?? '', last ?? ''].map((part) => part.trim()).filter(Boolean).join(' ');
}

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
