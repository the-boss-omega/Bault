const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * A figure set into a sentence that reads the other way keeps its own direction: a
 * left-to-right isolate (LRI … PDI), invisible where the sentence is also left to right.
 * It is for a figure that is part of a phrase ("$39.00 a month"); a figure on its own
 * is an `Amount`, and a code is a `Code` or a `Serial`.
 */
export function isolateLtr(text: string): string {
  return `\u2066${text}\u2069`;
}

/**
 * A name set into a sentence keeps its own order: a first-strong isolate (FSI … PDI) takes the
 * direction of the name's first letter, so an English card name ("2011 Pokémon Call of Legends")
 * is read left to right inside a Hebrew sentence instead of being drawn "Call of Legends 2011",
 * and a full stop after it is the sentence's. Invisible where the sentence reads the same way.
 * For a name in a string that goes through `t()`; in markup, a `<bdi dir="auto">` does the same.
 */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}

export function formatUsd(minorUnits: number): string {
  return USD.format((minorUnits ?? 0) / 100);
}

export function formatUsdSigned(minorUnits: number): string {
  const sign = minorUnits < 0 ? '−' : '+';
  return `${sign}${formatUsd(Math.abs(minorUnits ?? 0))}`;
}

export function formatLedgerAmount(amount: number, direction: string): string {
  return `${direction === 'credit' ? '+' : '−'}${formatUsd(Math.abs(amount ?? 0))}`;
}

export function dollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[,\s$]/g, '');
  if (cleaned === '' || !/^\d*\.?\d{0,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function bpsToPercent(bps: number): string {
  return String(Number((bps / 100).toFixed(4)));
}

export function centsToDollars(minorUnits: number): string {
  return ((minorUnits ?? 0) / 100).toFixed(2);
}

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', {
    dateStyle: 'medium',
  }).format(date);
}

const intlLocale = (locale: string) => (locale === 'he' ? 'he-IL' : 'en-US');

/** The time of day, and nothing else: "6:08 AM", "06:08". */
export function formatTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** The calendar day a moment falls on, in the visitor's own time zone: what entries are grouped by. */
export function dayKey(iso: string | null | undefined): string {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The heading of a day in a register: the day's own words where there are any ("today", "yesterday", in the
 * language of the page, from the browser's own tables) and the date. Nothing here is a message of ours.
 */
export function formatDayHeading(iso: string, locale: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const lang = intlLocale(locale);
  const full = new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0 || days === 1) {
    const word = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-days, 'day');
    return `${word} · ${full}`;
  }
  return full;
}
