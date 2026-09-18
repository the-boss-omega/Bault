import { formatUsd } from './money';

/**
 * The membership catalogue and one member's state, as the SPA reads them.
 *
 * Shapes only — `GET /membership/tiers` is the source of truth for what a tier
 * covers, so the SPA never holds a second copy of an allowance. The one thing
 * defined here is the ORDER benefits are listed in, which is presentation and
 * belongs on this side.
 */

/** An allowance with no ceiling, as the API encodes it. */
export const UNLIMITED = -1;

export interface TierAllowanceCounts {
  allowed: number;
  used: number;
  remaining: number;
}

export interface MembershipTier {
  key: string;
  feeActionType: string;
  priceMinor: number;
  perCycle: Record<string, number>;
  storedItems: number;
  insuredShipments: number;
  insuredValueCapMinor: number;
  postageCreditMinor: number;
  commissionWaivedOnMinor: number;
  perks: string[];
}

export interface TierCatalogue {
  tiers: MembershipTier[];
  uncovered: string[];
  cycleDays: number;
  currency: string;
}

export interface MyMembership {
  tier: string;
  status: 'active' | 'cancelling' | 'ended';
  cycleLive: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  perCycle: Record<string, TierAllowanceCounts>;
  storedItems: number;
  insuredShipments: { allowed: number; used: number; capMinor: number };
  postage: { creditMinor: number; usedMinor: number };
  commission: { waivedOnMinor: number; usedMinor: number };
  perks: string[];
}

/**
 * The rows of the comparison table, in the order somebody meets them.
 *
 * Storage first because it is the reason most people join — it is the charge
 * that arrives without being asked for. Then the things you do on purpose.
 */
export const COMPARISON_ROWS = [
  'storedItems',
  'intake',
  'parcel_processing',
  'parcel_forwarding',
  'service',
  'service_fee:deslab',
  'service_fee:condition_inspection',
  'service_fee:video_review',
  'insuredShipments',
  'postage',
  'commission',
] as const;

export type ComparisonRow = (typeof COMPARISON_ROWS)[number];

/**
 * An allowance as a cell.
 *
 * `null` means "not in this tier", which the table renders as an em dash rather
 * than a zero: zero reads as "included, none left", and the two are different.
 */
export function allowanceCell(tier: MembershipTier, row: ComparisonRow): string | null {
  switch (row) {
    case 'storedItems':
      return `${tier.storedItems.toLocaleString()}`;
    case 'insuredShipments':
      return `${tier.insuredShipments} · ${formatUsd(tier.insuredValueCapMinor)}`;
    case 'postage':
      return tier.postageCreditMinor > 0 ? formatUsd(tier.postageCreditMinor) : null;
    case 'commission':
      return tier.commissionWaivedOnMinor > 0 ? formatUsd(tier.commissionWaivedOnMinor) : null;
    default: {
      const n = tier.perCycle[row];
      if (n === undefined) return null;
      return n === UNLIMITED ? '∞' : String(n);
    }
  }
}

/** How much of an allowance is gone, 0–1, for the proportion bar. */
export function usedFraction(counts: TierAllowanceCounts): number {
  if (counts.allowed === UNLIMITED || counts.allowed <= 0) return 0;
  return Math.min(1, counts.used / counts.allowed);
}
