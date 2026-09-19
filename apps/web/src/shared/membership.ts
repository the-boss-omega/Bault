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
  escrowValueCapMinor: number;
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
  scheduledTier: string | null;
  currentFeeMinor: number;
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
  'shipping_addon:gps_tracker',
  'insuredShipments',
  'postage',
  'commission',
  'escrow_fee',
  'cash_out_fee',
  'show_pickup',
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
    case 'escrow_fee': {
      // A count AND a ceiling: "1 · $5,000.00" — one deal, up to that value.
      const n = tier.perCycle.escrow_fee;
      if (n === undefined) return null;
      return tier.escrowValueCapMinor > 0 ? `${n} · ${formatUsd(tier.escrowValueCapMinor)}` : String(n);
    }
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

/**
 * What pressing a tier's button would do, and what it would cost today.
 *
 * Four different requests share one button, and they are not priced alike:
 *
 *   join       not a member: the full fee now.
 *   upgrade    a dearer tier: the full fee LESS the unused part of the current
 *              cycle, which is what the API charges (`MembershipService.subscribe`).
 *   downgrade  a cheaper tier: nothing today; it takes effect at renewal.
 *   keep       the current tier, with a cancellation or downgrade pending:
 *              nothing at all — the pending change is simply dropped.
 *
 * The confirmation sentence is built from this, so the figure on the button is
 * the figure the wallet sees. The credit is computed the same way the server
 * computes it; the few seconds between reading and clicking move it by less than
 * a cent a minute, and the success notice reports the exact amount charged.
 */
export type TierAction =
  | { kind: 'join'; chargeMinor: number }
  | { kind: 'upgrade'; chargeMinor: number; creditMinor: number }
  | { kind: 'downgrade'; effectiveFrom: string }
  | { kind: 'keep' };

export function tierAction(
  mine: MyMembership | null,
  target: MembershipTier,
  tierOrder: readonly string[],
  now = Date.now(),
): TierAction {
  if (!mine || mine.status === 'ended') return { kind: 'join', chargeMinor: target.priceMinor };
  if (mine.tier === target.key) return { kind: 'keep' };
  if (tierOrder.indexOf(target.key) < tierOrder.indexOf(mine.tier)) {
    return { kind: 'downgrade', effectiveFrom: mine.currentPeriodEnd };
  }
  const start = Date.parse(mine.currentPeriodStart);
  const end = Date.parse(mine.currentPeriodEnd);
  const cycle = end - start;
  const left = end - now;
  const creditMinor =
    mine.cycleLive && cycle > 0 && left > 0 ? Math.floor((mine.currentFeeMinor * left) / cycle) : 0;
  return { kind: 'upgrade', creditMinor, chargeMinor: Math.max(0, target.priceMinor - creditMinor) };
}

