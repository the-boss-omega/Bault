/**
 * Money utilities (T012).
 *
 * Money is ALWAYS an integer amount in the currency's minor unit plus an explicit
 * currency code — never a float (Constitution: integers in minor units). All
 * arithmetic here operates on integers and refuses to mix currencies, so a whole
 * class of rounding and currency-mismatch bugs is impossible by construction.
 */
export interface Money {
  /** Amount in the smallest unit (USD cents). Always an integer. */
  readonly amount: number;
  /** ISO-4217 code, uppercased. */
  readonly currency: string;
}

export function money(amount: number, currency: string): Money {
  if (!Number.isInteger(amount)) {
    throw new Error(`Money.amount must be an integer minor unit, got ${amount}`);
  }
  return { amount, currency: currency.toUpperCase() };
}

export const zero = (currency: string): Money => money(0, currency);

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

/**
 * Apply basis-point rate (1% = 100 bps), rounding to the nearest minor unit.
 * Used for percentage fees (e.g. the marketplace fee) — PRC pricing model.
 */
export function applyBasisPoints(base: Money, bps: number): Money {
  return money(Math.round((base.amount * bps) / 10_000), base.currency);
}

export const isNegative = (m: Money): boolean => m.amount < 0;

/** Sum a list of same-currency amounts (used to derive wallet balance from ledger). */
export function sum(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

/**
 * A minor-unit amount as a person reads it: `4137` → `$41.37`.
 *
 * Every message in this product that quoted an amount built the string at the
 * call site, and twelve of the sixteen sites dropped the currency symbol — so a
 * shipment refusal said "Short by 45.00", a top-up limit said "The smallest
 * top-up is 10.00", and the four that did print a `$` made the other twelve look
 * like a different product. The figure is the actionable part of those
 * sentences; it should not be the part that is formatted by accident.
 *
 * Deliberately not `Intl.NumberFormat`: these strings are assembled on the
 * server, which has no reader locale, and the SPA translates the SENTENCE while
 * keeping the number (see `carriers.ts`). USD is the only currency the platform
 * settles in; anything else prints its code so a mistake is visible rather than
 * silently wrong.
 */
export function formatMinor(minor: number, currencyCode = 'USD'): string {
  const value = (Math.abs(minor) / 100).toFixed(2);
  const sign = minor < 0 ? '-' : '';
  return currencyCode.toUpperCase() === 'USD' ? `${sign}$${value}` : `${sign}${value} ${currencyCode.toUpperCase()}`;
}
