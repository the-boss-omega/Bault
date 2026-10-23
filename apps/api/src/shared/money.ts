export interface Money {
  readonly amount: number;
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

export function applyBasisPoints(base: Money, bps: number): Money {
  return money(Math.round((base.amount * bps) / 10_000), base.currency);
}

export const isNegative = (m: Money): boolean => m.amount < 0;

export function sum(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export function formatMinor(minor: number, currencyCode = 'USD'): string {
  const value = (Math.abs(minor) / 100).toFixed(2);
  const sign = minor < 0 ? '-' : '';
  return currencyCode.toUpperCase() === 'USD' ? `${sign}$${value}` : `${sign}${value} ${currencyCode.toUpperCase()}`;
}
