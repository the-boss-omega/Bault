/**
 * Single money formatter for the whole web app. Every monetary value on the
 * platform is USD ($); amounts travel over the wire as integer minor units
 * (cents), so we divide by 100 and render with the `$` symbol via Intl.
 *
 * There are no shekels/agorot anywhere — the currency string returned by the API
 * is deliberately ignored here so the UI can never display a stale/foreign symbol.
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
