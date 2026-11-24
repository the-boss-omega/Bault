export type TierKey = 'bronze' | 'silver' | 'gold';

export const TIER_KEYS: readonly TierKey[] = ['bronze', 'silver', 'gold'];

export const TIER_WINDOW_DAYS = 90;

export interface TierRule {
  key: TierKey;
  minActions: number;
  minSpentMinor: number;
  discountBps: number;
}

export const TIER_RULES: readonly TierRule[] = [
  { key: 'bronze', minActions: 0, minSpentMinor: 0, discountBps: 0 },
  { key: 'silver', minActions: 10, minSpentMinor: 50_000, discountBps: 1_000 },
  { key: 'gold', minActions: 30, minSpentMinor: 200_000, discountBps: 2_000 },
];

export interface TierUsage {
  actions: number;
  spentMinor: number;
}

export function isTierKey(value: unknown): value is TierKey {
  return typeof value === 'string' && (TIER_KEYS as readonly string[]).includes(value);
}

export function tierRule(key: string | null | undefined): TierRule {
  return TIER_RULES.find((r) => r.key === key) ?? TIER_RULES[0]!;
}

export function tierFor(usage: TierUsage): TierKey {
  let reached: TierKey = 'bronze';
  for (const rule of TIER_RULES) {
    if (usage.actions >= rule.minActions || usage.spentMinor >= rule.minSpentMinor) reached = rule.key;
  }
  return reached;
}

export interface NextTier {
  tier: TierKey;
  minActions: number;
  minSpentMinor: number;
  actionsToGo: number;
  spentToGoMinor: number;
}

export function nextTier(current: string, usage: TierUsage): NextTier | null {
  const at = TIER_RULES.findIndex((r) => r.key === current);
  const next = TIER_RULES[at + 1];
  if (!next) return null;
  return {
    tier: next.key,
    minActions: next.minActions,
    minSpentMinor: next.minSpentMinor,
    actionsToGo: Math.max(0, next.minActions - usage.actions),
    spentToGoMinor: Math.max(0, next.minSpentMinor - usage.spentMinor),
  };
}

export function discountedMinor(listMinor: number, discountBps: number): number {
  if (listMinor <= 0 || discountBps <= 0) return listMinor;
  return listMinor - Math.round((listMinor * discountBps) / 10_000);
}

export const UNLIMITED = -1;

export const ALLOWANCE_ALIASES: Readonly<Record<string, string>> = {
  intake_lot: 'intake',
};

export function allowanceFor(billedAs: string): string {
  return ALLOWANCE_ALIASES[billedAs] ?? billedAs;
}

export interface HonouredAllowance {
  key: TierKey;
  perCycle: Record<string, number>;
  insuredShipments: number;
  insuredValueCapMinor: number;
  postageCreditMinor: number;
  commissionWaivedOnMinor: number;
  escrowValueCapMinor: number;
  rushIncluded: boolean;
}

export const HONOURED_ALLOWANCES: readonly HonouredAllowance[] = [
  {
    key: 'bronze',
    perCycle: {
      intake: 4,
      parcel_processing: 2,
      'service_fee:deslab': 2,
    },
    insuredShipments: 1,
    insuredValueCapMinor: 50_000,
    postageCreditMinor: 1_000,
    commissionWaivedOnMinor: 0,
    escrowValueCapMinor: 0,
    rushIncluded: false,
  },
  {
    key: 'silver',
    perCycle: {
      intake: 10,
      parcel_processing: 5,
      parcel_forwarding: 2,
      'service_fee:deslab': 5,
      'service_fee:condition_inspection': 2,
      'service_fee:video_review': 2,
    },
    insuredShipments: 3,
    insuredValueCapMinor: 100_000,
    postageCreditMinor: 3_000,
    commissionWaivedOnMinor: 100_000,
    escrowValueCapMinor: 0,
    rushIncluded: true,
  },
  {
    key: 'gold',
    perCycle: {
      intake: 25,
      parcel_processing: UNLIMITED,
      parcel_forwarding: UNLIMITED,
      service: 8,
      'service_fee:deslab': UNLIMITED,
      'service_fee:condition_inspection': 8,
      'service_fee:video_review': 8,
      'shipping_addon:gps_tracker': 2,
      escrow_fee: 1,
      cash_out_fee: 2,
      show_pickup: 2,
    },
    insuredShipments: 6,
    insuredValueCapMinor: 250_000,
    postageCreditMinor: 10_000,
    commissionWaivedOnMinor: 300_000,
    escrowValueCapMinor: 500_000,
    rushIncluded: true,
  },
];

export function honouredAllowance(key: string | null | undefined): HonouredAllowance | undefined {
  return key ? HONOURED_ALLOWANCES.find((a) => a.key === key) : undefined;
}

export function remaining(allowance: HonouredAllowance, action: string, used: number): number {
  const allowed = allowance.perCycle[action];
  if (allowed === undefined) return 0;
  if (allowed === UNLIMITED) return UNLIMITED;
  return Math.max(0, allowed - used);
}

export function covers(allowance: HonouredAllowance, action: string, used: number): boolean {
  const left = remaining(allowance, action, used);
  return left === UNLIMITED || left > 0;
}
