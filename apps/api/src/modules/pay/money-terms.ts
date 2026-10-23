export const CASHOUT_BAND_MINOR = 10_000;

export const CASHOUT_SMALL_BPS = 600;
export const CASHOUT_SMALL_MINIMUM_MINOR = 99;

export const CASHOUT_LARGE_FIXED_MINOR = 500;
export const CASHOUT_LARGE_BPS = 100;

export const CASHOUT_FEE_ACTION = 'cash_out_fee';

export function cashOutFeeMinor(amountMinor: number): number {
  if (amountMinor <= 0) return 0;
  if (amountMinor > CASHOUT_BAND_MINOR) {
    return CASHOUT_LARGE_FIXED_MINOR + Math.ceil((amountMinor * CASHOUT_LARGE_BPS) / 10_000);
  }
  return Math.max(Math.ceil((amountMinor * CASHOUT_SMALL_BPS) / 10_000), CASHOUT_SMALL_MINIMUM_MINOR);
}

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

export function cashOutNetMinor(amountMinor: number): number {
  return cashOutSettlement(amountMinor).netMinor;
}

export const CHARGEBACK_FEE_MINOR = 2_500;
export const CHARGEBACK_FEE_ACTION = 'chargeback_fee';

export interface FundingRoute {
  key: string;
  label: string;
  instant: boolean;
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
