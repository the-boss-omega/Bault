/**
 * What moving money costs, and the routes it can move along:
 *
 *   - the CASH-OUT FEE, quoted so a collector knows what lands before asking;
 *   - the FUNDING ROUTES, and whether each settles by itself;
 *   - the CHARGEBACK FEE, for a card top-up the cardholder reverses later.
 *
 * Pure data and predicates: it talks to nothing, so all of it is directly
 * testable, and the SPA mirrors the shape while fetching the figures.
 */

/* ============================================================
   Cashing out
   ============================================================ */

/**
 * The fee schedule: two bands with a kink at $100. Below it a flat percentage
 * with a floor, because the provider's own minimum dominates a small payout;
 * above it a fixed component plus a much smaller percentage, because the work
 * does not scale with the amount.
 */
export const CASHOUT_BAND_MINOR = 10_000; // $100

/** Under the band: a percentage, with a floor. */
export const CASHOUT_SMALL_BPS = 600; // 6.00%
export const CASHOUT_SMALL_MINIMUM_MINOR = 99; // $0.99

/** Over the band: a fixed component plus a percentage. */
export const CASHOUT_LARGE_FIXED_MINOR = 500; // $5.00
export const CASHOUT_LARGE_BPS = 100; // 1.00%

/**
 * The pricing-rule action for the cash-out fee. The fee is charged from the
 * schedule above; a rule under this action is only shown on the price list.
 */
export const CASHOUT_FEE_ACTION = 'cash_out_fee';

/**
 * What comes off a cash-out of this size.
 *
 * Rounded UP, so Bault never quotes a fee lower than the one it takes.
 */
export function cashOutFeeMinor(amountMinor: number): number {
  if (amountMinor <= 0) return 0;
  if (amountMinor > CASHOUT_BAND_MINOR) {
    return CASHOUT_LARGE_FIXED_MINOR + Math.ceil((amountMinor * CASHOUT_LARGE_BPS) / 10_000);
  }
  return Math.max(Math.ceil((amountMinor * CASHOUT_SMALL_BPS) / 10_000), CASHOUT_SMALL_MINIMUM_MINOR);
}

/**
 * What a cash-out moves, in one place: the quote, the payout and the ledger all
 * read it from here.
 *
 * The collector asks for `grossMinor`, and exactly that leaves the wallet:
 * `netMinor` as the withdrawal the provider pays out, and `feeMinor` as its own
 * row beside it, so the statement shows both and the fee is never taken twice.
 *
 * `waivedMinor` is what a membership waived of the fee at completion. It can
 * only lower the fee: the collector receives more, and is still debited
 * exactly what they asked for.
 */
export interface CashOutSettlement {
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
}

export function cashOutSettlement(amountMinor: number, waivedMinor = 0): CashOutSettlement {
  const grossMinor = Math.max(0, amountMinor);
  const feeMinor = Math.min(grossMinor, Math.max(0, cashOutFeeMinor(grossMinor) - Math.max(0, waivedMinor)));
  return { grossMinor, feeMinor, netMinor: grossMinor - feeMinor };
}

/** What actually lands in the collector's account. */
export function cashOutNetMinor(amountMinor: number): number {
  return cashOutSettlement(amountMinor).netMinor;
}

/* ============================================================
   Chargebacks
   ============================================================ */

/**
 * What a reversed card payment costs the account it was credited to.
 *
 * The provider charges Bault a fee for handling the dispute whoever wins it,
 * and the account that received the money caused it. Recording it on the
 * ledger also makes the reversal visible to the collector.
 */
export const CHARGEBACK_FEE_MINOR = 2_500; // $25
export const CHARGEBACK_FEE_ACTION = 'chargeback_fee';

/* ============================================================
   Getting money in
   ============================================================ */

/**
 * How a top-up can be made, and whether it settles by itself.
 *
 * A card or PayPal Goods & Services payment is confirmed by the provider, so
 * the balance can move the moment the payment settles. A bank transfer or a
 * PayPal Friends & Family payment is confirmed by nothing, so a person has to
 * see it arrive, which is what the wallet request workflow is for.
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
