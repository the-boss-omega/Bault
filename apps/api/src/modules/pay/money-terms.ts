/**
 * What moving money costs, and the routes it can move along.
 *
 * Three things lived nowhere before this module.
 *
 * A CASH-OUT FEE. Cashing out was free and no figure was quoted anywhere, which
 * reads as generous and is really an omission: paying somebody out costs a
 * provider fee that Bault was absorbing silently, and a collector planning a
 * $40 withdrawal deserves to know what lands in their account before they ask
 * for it rather than after.
 *
 * THE FUNDING ROUTES. `bank_transfer` was one of five strings on a form, and no
 * account details were published anywhere for a customer to actually pay into —
 * so choosing it told Bault how the money would arrive and told the customer
 * nothing about how to send it.
 *
 * A CHARGEBACK FEE. A card top-up can be reversed by the cardholder weeks after
 * the goods have shipped. Bault had no way to record that, no fee for it, and
 * no policy naming it.
 *
 * Pure data and predicates: it talks to nothing, so all of it is directly
 * testable, and the SPA mirrors the shape while fetching the figures.
 */

/* ============================================================
   Cashing out
   ============================================================ */

/**
 * The fee schedule, mirroring the reference service.
 *
 * Two bands with a deliberate kink at $100. Below it a flat percentage with a
 * floor, because the provider's own minimum dominates a small payout; above it
 * a fixed component plus a much smaller percentage, because the work does not
 * scale with the amount and a flat 6% on $5,000 would be indefensible.
 */
export const CASHOUT_BAND_MINOR = 10_000; // $100

/** Under the band: a percentage, with a floor. */
export const CASHOUT_SMALL_BPS = 600; // 6.00%
export const CASHOUT_SMALL_MINIMUM_MINOR = 99; // $0.99

/** Over the band: a fixed component plus a percentage. */
export const CASHOUT_LARGE_FIXED_MINOR = 500; // $5.00
export const CASHOUT_LARGE_BPS = 100; // 1.00%

/** The pricing-rule action carrying a configured override. */
export const CASHOUT_FEE_ACTION = 'cash_out_fee';

/**
 * What comes off a cash-out of this size.
 *
 * Rounded UP, so Bault never quotes a fee lower than the one it takes. A cent
 * in the platform's favour on a rounding boundary is defensible; a cent the
 * other way means the quote was wrong.
 */
export function cashOutFeeMinor(amountMinor: number): number {
  if (amountMinor <= 0) return 0;
  if (amountMinor > CASHOUT_BAND_MINOR) {
    return CASHOUT_LARGE_FIXED_MINOR + Math.ceil((amountMinor * CASHOUT_LARGE_BPS) / 10_000);
  }
  return Math.max(Math.ceil((amountMinor * CASHOUT_SMALL_BPS) / 10_000), CASHOUT_SMALL_MINIMUM_MINOR);
}

/** What actually lands in the collector's account. */
export function cashOutNetMinor(amountMinor: number): number {
  return Math.max(0, amountMinor - cashOutFeeMinor(amountMinor));
}

/* ============================================================
   Chargebacks
   ============================================================ */

/**
 * What a reversed card payment costs the account it was credited to.
 *
 * Not a punishment: the provider charges Bault a fee for handling the dispute
 * regardless of who wins it, and the account that received the money is the one
 * that caused it. Recording it as a fee on the ledger — rather than quietly
 * absorbing it — is also what makes the reversal visible to the collector at
 * all, which matters when the first they hear of it is a negative balance.
 */
export const CHARGEBACK_FEE_MINOR = 2_500; // $25
export const CHARGEBACK_FEE_ACTION = 'chargeback_fee';

/* ============================================================
   Getting money in
   ============================================================ */

/**
 * How a top-up can be made, and — the part that matters — whether it settles by
 * itself.
 *
 * This is the distinction the product was missing. A card or PayPal Goods &
 * Services payment is confirmed by the provider, so nothing needs a human: the
 * balance can move the moment the payment settles. A bank transfer or a PayPal
 * Friends & Family payment is confirmed by nothing, so a person has to look at
 * a statement and say "yes, that arrived" — which is exactly what the wallet
 * request workflow is for.
 *
 * Treating those two as the same thing is what made every top-up wait on a
 * reviewer, including the ones a provider had already guaranteed.
 */
export interface FundingRoute {
  key: string;
  label: string;
  /** True when a provider confirms receipt and no human review is needed. */
  instant: boolean;
  /** The fee Bault adds. Zero on every route today; present so it can move. */
  feeBps: number;
  description: string;
}

export const FUNDING_ROUTES: readonly FundingRoute[] = [
  {
    key: 'card',
    label: 'Card',
    instant: true,
    feeBps: 0,
    description: 'Settles immediately. The balance moves as soon as the payment clears.',
  },
  {
    key: 'paypal_gs',
    label: 'PayPal (Goods & Services)',
    instant: true,
    feeBps: 0,
    description: 'Settles immediately, and carries PayPal buyer protection.',
  },
  {
    key: 'paypal_ff',
    label: 'PayPal (Friends & Family)',
    instant: false,
    feeBps: 0,
    description:
      'Cheaper for you, but nothing confirms it automatically — somebody here has to see it arrive, which takes a few hours.',
  },
  {
    key: 'bank_transfer',
    label: 'Bank transfer',
    instant: false,
    feeBps: 0,
    description:
      'No fee, and the slowest. A person reconciles it against the account statement, usually the same working day.',
  },
];

const ROUTE_BY_KEY = new Map(FUNDING_ROUTES.map((r) => [r.key, r]));

export function fundingRoute(key: string): FundingRoute | undefined {
  return ROUTE_BY_KEY.get(key);
}

export function isInstantRoute(key: string): boolean {
  return fundingRoute(key)?.instant === true;
}
