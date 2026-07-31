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
