const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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
