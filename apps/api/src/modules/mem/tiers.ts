export const UNLIMITED = -1;

export const ALLOWANCE_ALIASES: Readonly<Record<string, string>> = {
  intake_lot: 'intake',
};

export function allowanceFor(billedAs: string): string {
  return ALLOWANCE_ALIASES[billedAs] ?? billedAs;
}

export type TierKey = 'folio' | 'registry' | 'trust';

export const TIER_KEYS: readonly TierKey[] = ['folio', 'registry', 'trust'];

export interface MembershipTier {
  key: TierKey;
  feeActionType: string;
  listPriceMinor: number;

  perCycle: Record<string, number>;

  storedItems: number;

  insuredShipments: number;
  insuredValueCapMinor: number;

  postageCreditMinor: number;

  commissionWaivedOnMinor: number;

  escrowValueCapMinor: number;

  perks: readonly string[];
}

export const MEMBERSHIP_TIERS: readonly MembershipTier[] = [
  {
    key: 'folio',
    feeActionType: 'membership:folio',
    listPriceMinor: 3_900,
    perCycle: {
      intake: 4,
      parcel_processing: 2,
      'service_fee:deslab': 2,
    },
    storedItems: 60,
    insuredShipments: 1,
    insuredValueCapMinor: 50_000,
    postageCreditMinor: 1_000,
    commissionWaivedOnMinor: 0,
    escrowValueCapMinor: 0,
    perks: ['storage_clock_stops', 'handling_included'],
  },
  {
    key: 'registry',
    feeActionType: 'membership:registry',
    listPriceMinor: 19_900,
    perCycle: {
      intake: 10,
      parcel_processing: 5,
      parcel_forwarding: 2,
      'service_fee:deslab': 5,
      'service_fee:condition_inspection': 2,
      'service_fee:video_review': 2,
    },
    storedItems: 200,
    insuredShipments: 3,
    insuredValueCapMinor: 100_000,
    postageCreditMinor: 3_000,
    commissionWaivedOnMinor: 100_000,
    escrowValueCapMinor: 0,
    perks: ['storage_clock_stops', 'handling_included', 'oversized_storage', 'rush_included', 'priority_queue'],
  },
  {
    key: 'trust',
    feeActionType: 'membership:trust',
    listPriceMinor: 69_900,
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
    storedItems: 750,
    insuredShipments: 6,
    insuredValueCapMinor: 250_000,
    postageCreditMinor: 10_000,
    commissionWaivedOnMinor: 300_000,
    escrowValueCapMinor: 500_000,
    perks: [
      'storage_clock_stops',
      'handling_included',
      'oversized_storage',
      'rush_included',
      'priority_queue',
      'named_contact',
    ],
  },
];

const BY_KEY = new Map(MEMBERSHIP_TIERS.map((t) => [t.key, t]));

export function membershipTier(key: string | null | undefined): MembershipTier | undefined {
  return key ? BY_KEY.get(key as TierKey) : undefined;
}

export function isTierKey(value: string): value is TierKey {
  return BY_KEY.has(value as TierKey);
}

export function tierRank(key: string | null | undefined): number {
  return key ? TIER_KEYS.indexOf(key as TierKey) : -1;
}

export const UNCOVERED = [
  'carrier_postage_above_credit',
  'grading_fees',
  'white_glove',
  'insurance_above_cap',
  'consignment_commission',
  'chargeback_fee',
  'restocking_fee',
] as const;

export function remaining(tier: MembershipTier, action: string, used: number): number {
  const allowed = tier.perCycle[action];
  if (allowed === undefined) return 0;
  if (allowed === UNLIMITED) return UNLIMITED;
  return Math.max(0, allowed - used);
}

export function covers(tier: MembershipTier, action: string, used: number): boolean {
  const left = remaining(tier, action, used);
  return left === UNLIMITED || left > 0;
}

export function fullUseCostMinor(
  tier: MembershipTier,
  unitPrices: Record<string, number>,
  fairUse: Record<string, number> = {},
  storageUnitMinorPerItemPerCycle = 17,
): number {
  let total = 0;
  for (const [action, allowed] of Object.entries(tier.perCycle)) {
    const count = allowed === UNLIMITED ? (fairUse[action] ?? 10) : allowed;
    total += count * (unitPrices[action] ?? 0);
  }
  total += tier.storedItems * storageUnitMinorPerItemPerCycle;
  total += tier.insuredShipments * Math.max(200, Math.ceil((tier.insuredValueCapMinor * 150) / 10_000));
  total += tier.postageCreditMinor;
  total += Math.ceil((tier.commissionWaivedOnMinor * 500) / 10_000);
  return total;
}
