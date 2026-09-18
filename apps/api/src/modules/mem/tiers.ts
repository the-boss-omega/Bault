/**
 * The membership tiers, and what each one actually covers.
 *
 * WHAT THIS IS NOT. It is not a discount scheme. A discount still charges you
 * every time and still makes the bill a surprise, which is the thing collectors
 * complain about — the reference service is explicitly pay-as-you-send with no
 * membership at all, and its published fee list is two pages long. A member here
 * pays ONE fixed amount each month and the services in their tier are simply
 * not billed again.
 *
 * THE THREE RULES THIS FILE ENFORCES, and they are the whole design:
 *
 *   1. **Everything included has a ceiling.** Every allowance below is a hard
 *      number, so Bault's maximum cost per member per month is computable before
 *      anybody signs up. That is what makes a fixed fee safe to sell.
 *   2. **There is no overage rate.** Anywhere. When an allowance runs out the
 *      service is not silently billed at some higher number — it reverts to its
 *      ordinary published price and requires the same explicit confirmation any
 *      paid action requires. A member can never be charged for something they
 *      did not press a button on.
 *   3. **Allowances do not roll over.** A cycle is a cycle. This is what keeps
 *      (1) true: a rolling balance makes the maximum unbounded again.
 *
 * WHAT IS DELIBERATELY NOT COVERED: carrier postage beyond the credit, the
 * graders' own fees, white glove, and the penalties (chargeback, restocking).
 * The first three are other people's money — a pass-through Bault cannot cap —
 * and the last two are not services, they are consequences. `UNCOVERED` at the
 * bottom of this file states them in one place so the tier page can print them.
 *
 * Pure data and predicates, like `carriers.ts` and `boxes.ts`. It talks to
 * nothing, so all of it is directly testable, and the SPA fetches the same
 * catalogue from `GET /membership/tiers` rather than mirroring it by hand.
 */

/** An allowance with no ceiling. Stored as a number so it survives JSON. */
export const UNLIMITED = -1;

export type TierKey = 'folio' | 'registry' | 'trust';

/** Every tier key, cheapest first. Ordering is the upgrade path. */
export const TIER_KEYS: readonly TierKey[] = ['folio', 'registry', 'trust'];

export interface MembershipTier {
  key: TierKey;
  /**
   * The pricing-rule action carrying this tier's monthly fee.
   *
   * The fee is a RULE, not a constant, for the same reason every other price in
   * this system is: Principle VI makes the rules the source of truth, so a fee
   * can be changed without a deploy and the rule in force when a member was
   * charged is frozen onto that charge. `listPriceMinor` below is only the
   * fallback for an unconfigured tier, exactly as the shipping add-ons do it.
   */
  feeActionType: string;
  /** The catalogue price, used only when no rule is in force. */
  listPriceMinor: number;

  /**
   * Per-event actions this tier covers, and how many per cycle.
   *
   * Keyed by the EFFECTIVE billing action — `feeActionType ?? actionType` as
   * `BillingService` resolves it — so a tier can cover cracking a slab
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

  /** Perks with no unit price, listed because they are real. */
  perks: readonly string[];
}

/**
 * The tiers.
 *
 * Named for what a collection IS at each stage rather than for a metal.
 * `DESIGN.md` rejects the whole gold-accent register — "those are pictures of
 * security, and a picture of security is what you show when you cannot show the
 * thing itself" — and Gold/Platinum/Diamond is that same picture in words.
 *
 *   FOLIO     a collection you keep. The entry tier: storage stops being a
 *             clock you have to watch.
 *   REGISTRY  a collection that is working. You list, sell and ship, so the
 *             record is doing something for you rather than just holding still.
 *   TRUST     a collection held the way a trustee holds property. The top tier,
 *             and the only word in the language that means exactly what Bault
 *             claims to be doing.
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
    },
    storedItems: 750,
    insuredShipments: 6,
    insuredValueCapMinor: 250_000, // $2,500
    postageCreditMinor: 10_000, // $100
    commissionWaivedOnMinor: 300_000, // $3,000 of sale value
    perks: [
      'storage_clock_stops',
      'handling_included',
      'oversized_storage',
      'rush_included',
      'priority_queue',
      'show_pickup',
      'gps_tracker',
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
 * What no tier covers, and why — published, not buried.
 *
 * Stated as keys rather than sentences so the SPA translates them. Every one of
 * these still goes through the ordinary flow where the price is shown on the
 * control before the control does anything.
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
 * `used` is what the current cycle has already consumed. Returns 0 for anything
 * the tier does not cover at all, which is the same answer as "you have used
 * them up" on purpose: both mean *this will be charged, after you approve it*,
 * and the caller does not need to tell them apart.
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
 * This is the number the whole model rests on, and it is computed rather than
 * asserted so it cannot quietly drift when somebody widens an allowance. An
 * unlimited allowance is scored at its `fairUse` figure, because "unlimited"
 * on a thing a human has to physically do is bounded by the human.
 *
 * `unitPrices` comes from the pricing rules, so this reflects what Bault would
 * actually forgo rather than a figure typed in beside it.
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
