/**
 * The membership tiers, and what each one covers.
 *
 * A member pays one fixed amount each month and the services in their tier are
 * not billed again. Three rules hold the design together:
 *
 *   1. **Everything included has a ceiling.** Every allowance below is a hard
 *      number, so Bault's maximum cost per member per month is computable before
 *      anybody signs up. That is what makes a fixed fee safe to sell.
 *   2. **There is no overage rate.** When an allowance runs out the service
 *      reverts to its ordinary published price and needs the same explicit
 *      confirmation as any paid action.
 *   3. **Allowances do not roll over.** A rolling balance would make the
 *      maximum in (1) unbounded again.
 *
 * Not covered: carrier postage beyond the credit, graders' own fees and white
 * glove (pass-through costs Bault cannot cap), and the penalties (chargeback,
 * restocking). `UNCOVERED` lists them so the tier page can print them.
 *
 * Pure data and predicates, like `carriers.ts` and `boxes.ts`. The SPA fetches
 * the same catalogue from `GET /membership/tiers` rather than mirroring it.
 */

/** An allowance with no ceiling. Stored as a number so it survives JSON. */
export const UNLIMITED = -1;

/**
 * Fee actions that draw on ANOTHER action's allowance.
 *
 * A lot is billed under its own rule (`intake_lot`), but to a member it is
 * still one thing being booked in, so it uses one of their intakes. Listed
 * explicitly rather than inferred from a prefix: a general "fall back to the
 * parent action" rule would let a flat-service allowance pay for inspections
 * once the inspection allowance ran out, which is more than the table promises.
 */
export const ALLOWANCE_ALIASES: Readonly<Record<string, string>> = {
  intake_lot: 'intake',
};

/** The allowance a billed action draws on. */
export function allowanceFor(billedAs: string): string {
  return ALLOWANCE_ALIASES[billedAs] ?? billedAs;
}

export type TierKey = 'folio' | 'registry' | 'trust';

/** Every tier key, cheapest first. Ordering is the upgrade path. */
export const TIER_KEYS: readonly TierKey[] = ['folio', 'registry', 'trust'];

export interface MembershipTier {
  key: TierKey;
  /**
   * The pricing-rule action carrying this tier's monthly fee.
   *
   * The fee is a rule (Principle VI), so it can change without a deploy and the
   * rule in force is frozen onto each charge. `listPriceMinor` is only the
   * fallback for an unconfigured tier, as with the shipping add-ons.
   */
  feeActionType: string;
  /** The catalogue price, used only when no rule is in force. */
  listPriceMinor: number;

  /**
   * Per-event actions this tier covers, and how many per cycle.
   *
   * Keyed by the EFFECTIVE billing action (`feeActionType ?? actionType`, as
   * `BillingService` resolves it), so a tier can cover cracking a slab
   * (`service_fee:deslab`) without covering every flat `service`.
   */
  perCycle: Record<string, number>;

  /** Items whose storage is included. Beyond this, storage bills as usual. */
  storedItems: number;

  /** Outbound parcels per cycle whose insurance premium is included. */
  insuredShipments: number;
  /** The declared value covered on each of those. Above it, the member pays. */
  insuredValueCapMinor: number;

  /** Carrier postage covered per cycle, in minor units. */
  postageCreditMinor: number;

  /** Sale value per cycle on which the marketplace commission is waived. */
  commissionWaivedOnMinor: number;

  /**
   * The largest deal value an escrow waiver covers in full. Above it the fee on
   * the excess is paid as usual. 0 where the tier waives no escrow fee at all.
   */
  escrowValueCapMinor: number;

  /** Perks with no unit price, listed because they are real. */
  perks: readonly string[];
}

/**
 * The tiers, named for what a collection is at each stage rather than for a
 * metal (`DESIGN.md` rejects the gold-accent register).
 *
 *   FOLIO     a collection you keep. The entry tier: storage stops being a
 *             clock you have to watch.
 *   REGISTRY  a collection that is working: you list, sell and ship.
 *   TRUST     a collection held the way a trustee holds property. The top tier.
 */
export const MEMBERSHIP_TIERS: readonly MembershipTier[] = [
  {
    key: 'folio',
    feeActionType: 'membership:folio',
    listPriceMinor: 3_900, // $39.00
    perCycle: {
      intake: 4,
      parcel_processing: 2,
      'service_fee:deslab': 2,
    },
    storedItems: 60,
    insuredShipments: 1,
    insuredValueCapMinor: 50_000, // $500
    postageCreditMinor: 1_000, // $10
    commissionWaivedOnMinor: 0,
    escrowValueCapMinor: 0,
    perks: ['storage_clock_stops', 'handling_included'],
  },
  {
    key: 'registry',
    feeActionType: 'membership:registry',
    listPriceMinor: 19_900, // $199.00
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
    insuredValueCapMinor: 100_000, // $1,000
    postageCreditMinor: 3_000, // $30
    commissionWaivedOnMinor: 100_000, // $1,000 of sale value
    escrowValueCapMinor: 0,
    perks: ['storage_clock_stops', 'handling_included', 'oversized_storage', 'rush_included', 'priority_queue'],
  },
  {
    key: 'trust',
    feeActionType: 'membership:trust',
    listPriceMinor: 69_900, // $699.00
    perCycle: {
      intake: 25,
      parcel_processing: UNLIMITED,
      parcel_forwarding: UNLIMITED,
      service: 8,
      'service_fee:deslab': UNLIMITED,
      'service_fee:condition_inspection': 8,
      'service_fee:video_review': 8,
      // A tracker in the parcel. Counted like any per-cycle action, and spent
      // when the parcel is paid for (`MembershipService.spendShippingCover`).
      'shipping_addon:gps_tracker': 2,
      // Fees that are not billed through `BillingService`, waived where each is
      // actually charged (see `MembershipService.waive`).
      escrow_fee: 1,
      cash_out_fee: 2,
      show_pickup: 2,
    },
    storedItems: 750,
    insuredShipments: 6,
    insuredValueCapMinor: 250_000, // $2,500
    postageCreditMinor: 10_000, // $100
    commissionWaivedOnMinor: 300_000, // $3,000 of sale value
    escrowValueCapMinor: 500_000, // one deal up to $5,000
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

/** Where a tier sits on the upgrade path. -1 when it is not a tier. */
export function tierRank(key: string | null | undefined): number {
  return key ? TIER_KEYS.indexOf(key as TierKey) : -1;
}

/**
 * What no tier covers. Keys rather than sentences, so the SPA translates them.
 * Each still goes through the ordinary flow where the price is shown before
 * anything happens.
 */
export const UNCOVERED = [
  'carrier_postage_above_credit',
  'grading_fees',
  'white_glove',
  'insurance_above_cap',
  'consignment_commission',
  'chargeback_fee',
  'restocking_fee',
] as const;

/**
 * How many of `action` this tier still covers this cycle.
 *
 * `used` is what the current cycle has already consumed. Returns 0 both for
 * anything the tier does not cover and for a spent allowance: both mean "this
 * will be charged, after you approve it".
 */
export function remaining(tier: MembershipTier, action: string, used: number): number {
  const allowed = tier.perCycle[action];
  if (allowed === undefined) return 0;
  if (allowed === UNLIMITED) return UNLIMITED;
  return Math.max(0, allowed - used);
}

/** Whether one more of `action` is covered right now. */
export function covers(tier: MembershipTier, action: string, used: number): boolean {
  const left = remaining(tier, action, used);
  return left === UNLIMITED || left > 0;
}

/**
 * The most this tier can cost Bault in one cycle, at the published prices.
 *
 * Computed rather than asserted, so it cannot drift when an allowance widens.
 * An unlimited allowance is scored at its `fairUse` figure (default 10).
 * `unitPrices` comes from the pricing rules.
 */
export function fullUseCostMinor(
  tier: MembershipTier,
  unitPrices: Record<string, number>,
  fairUse: Record<string, number> = {},
  storageUnitMinorPerItemPerCycle = 17, // 10% of a $5 intake, per 90 days, per month
): number {
  let total = 0;
  for (const [action, allowed] of Object.entries(tier.perCycle)) {
    const count = allowed === UNLIMITED ? (fairUse[action] ?? 10) : allowed;
    total += count * (unitPrices[action] ?? 0);
  }
  total += tier.storedItems * storageUnitMinorPerItemPerCycle;
  // The insurance premium is basis points of declared value, not a rule price.
  total += tier.insuredShipments * Math.max(200, Math.ceil((tier.insuredValueCapMinor * 150) / 10_000));
  total += tier.postageCreditMinor;
  total += Math.ceil((tier.commissionWaivedOnMinor * 500) / 10_000);
  return total;
}
