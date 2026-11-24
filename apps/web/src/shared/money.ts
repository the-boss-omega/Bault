const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}

const MINUS = '\u2212';

function signed(negative: boolean, plus: boolean): string {
  return negative ? MINUS : plus ? '+' : '';
}

export function formatUsd(minorUnits: number): string {
  const value = minorUnits ?? 0;
  return `${signed(value < 0, false)}${USD.format(Math.abs(value) / 100)}`;
}

export function formatUsdSigned(minorUnits: number): string {
  const value = minorUnits ?? 0;
  return `${signed(value < 0, true)}${USD.format(Math.abs(value) / 100)}`;
}

export function formatLedgerAmount(amount: number, direction: string): string {
  return `${signed(direction !== 'credit', true)}${USD.format(Math.abs(amount ?? 0) / 100)}`;
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

export function formatPercent(bps: number): string {
  return `${bpsToPercent(bps)}%`;
}

export function centsToDollars(minorUnits: number): string {
  return ((minorUnits ?? 0) / 100).toFixed(2);
}

const INTL_LOCALE: Record<string, string> = { en: 'en-US' };
const intlLocale = (locale: string) => INTL_LOCALE[locale] ?? 'en-US';

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: 'medium',
  }).format(date);
}

export function formatTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function dayKey(iso: string | null | undefined): string {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatAge(iso: string, locale: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((startOf(now) - startOf(date)) / 86_400_000));
  const words = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' });
  if (days < 14) return words.format(-days, 'day');
  if (days < 70) return words.format(-Math.round(days / 7), 'week');
  return words.format(-Math.round(days / 30), 'month');
}

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
