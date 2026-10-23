export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_PATTERN = /^[a-z0-9_.-]+$/;

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

export const NAME_PART_MAX = 80;

export function isValidNamePart(normalized: string): boolean {
  if (normalized.length === 0 || normalized.length > NAME_PART_MAX) return false;
  // eslint-disable-next-line no-control-regex
  return !/[<>\u0000-\u001f]/.test(normalized);
}

export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first ?? '', last ?? ''].map((p) => p.trim()).filter(Boolean).join(' ');
}

export interface LegacyNameSplit {
  firstName: string | null;
  lastName: string | null;
  reviewRequired: boolean;
}

export function splitLegacyDisplayName(displayName: string | null | undefined): LegacyNameSplit {
  const cleaned = normalizeNamePart(displayName ?? '');
  if (cleaned === '') return { firstName: null, lastName: null, reviewRequired: true };

  const words = cleaned.split(' ');
  if (words.length === 2) {
    return { firstName: words[0] ?? null, lastName: words[1] ?? null, reviewRequired: false };
  }
  return { firstName: cleaned.slice(0, NAME_PART_MAX), lastName: null, reviewRequired: true };
}
