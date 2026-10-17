/**
 * Money and date formatting for the whole web app. Every monetary value is USD
 * and travels over the wire as integer cents. Any currency string from the API
 * is ignored, so the UI never shows another symbol.
 *
 * The UI never asks a person to think in cents: `dollarsToCents` converts what
 * the user typed ("250" or "250.50") into the minor units the API expects.
 */
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format integer cents as e.g. `$500.00`. */
export function formatUsd(minorUnits: number): string {
  return USD.format((minorUnits ?? 0) / 100);
}

/** Signed variant for ledger rows: `+$500.00` / `−$500.00`. */
export function formatUsdSigned(minorUnits: number): string {
  const sign = minorUnits < 0 ? '−' : '+';
  return `${sign}${formatUsd(Math.abs(minorUnits ?? 0))}`;
}

/** A ledger row's signed amount, given the API's positive amount + direction. */
export function formatLedgerAmount(amount: number, direction: string): string {
  return `${direction === 'credit' ? '+' : '−'}${formatUsd(Math.abs(amount ?? 0))}`;
}

/**
 * Parse a dollar amount typed by a human into integer cents. Returns null when
 * the input is blank, malformed, or not positive, so callers can show a field
 * message instead of sending a bad request.
 */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[,\s$]/g, '');
  if (cleaned === '' || !/^\d*\.?\d{0,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/** Basis points as a percentage, without trailing zeros: 5 → "0.05", 150 → "1.5". */
export function bpsToPercent(bps: number): string {
  return String(Number((bps / 100).toFixed(4)));
}

/** Inverse of `dollarsToCents`, for pre-filling an editable amount field. */
export function centsToDollars(minorUnits: number): string {
  return ((minorUnits ?? 0) / 100).toFixed(2);
}

/** Full date and time for a detail view, e.g. `July 28, 2026 at 2:31 PM`. */
export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

/** Compact date for a table cell, e.g. `Jul 28, 2026`. */
export function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', {
    dateStyle: 'medium',
  }).format(date);
}
