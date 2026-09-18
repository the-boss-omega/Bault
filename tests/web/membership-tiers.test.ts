import { describe, it, expect } from 'vitest';
import {
  MEMBERSHIP_TIERS,
  TIER_KEYS,
  UNCOVERED,
  UNLIMITED,
  covers,
  fullUseCostMinor,
  isTierKey,
  membershipTier,
  remaining,
  tierRank,
} from '../../apps/api/src/modules/mem/tiers';

/**
 * The membership catalogue, as arithmetic.
 *
 * The tiers are pure data with predicates over them, which is the same shape as
 * `carriers.ts` and `boxes.ts` and for the same reason: the rules are the
 * product, and rules that can only be exercised through a database are rules
 * nobody checks.
 *
 * The cases that matter are the two the whole scheme is sold on — **there is no
 * overage** and **every allowance has a ceiling** — because both are properties
 * of this file and both would be easy to lose by widening one number.
 */

/** The published per-event prices, from `db/seed.ts`. */
const UNIT_PRICES: Record<string, number> = {
  intake: 500,
  parcel_processing: 200,
  parcel_forwarding: 400,
  service: 2_000,
  'service_fee:deslab': 500,
  'service_fee:condition_inspection': 1_500,
  'service_fee:video_review': 1_000,
};

describe('the tier catalogue', () => {
  it('is ordered cheapest first, and the order is the upgrade path', () => {
    const prices = MEMBERSHIP_TIERS.map((t) => t.listPriceMinor);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(MEMBERSHIP_TIERS.map((t) => t.key)).toEqual([...TIER_KEYS]);
    expect(tierRank('folio')).toBeLessThan(tierRank('registry'));
    expect(tierRank('registry')).toBeLessThan(tierRank('trust'));
    expect(tierRank('nonsense')).toBe(-1);
  });

  it('never takes away something a cheaper tier included', () => {
    // A tier that is more expensive and covers LESS of something is a trap, and
    // it is the kind of thing that happens by accident when one number is
    // tuned. Every allowance is monotonic up the ladder.
    for (let i = 1; i < MEMBERSHIP_TIERS.length; i += 1) {
      const lower = MEMBERSHIP_TIERS[i - 1]!;
      const higher = MEMBERSHIP_TIERS[i]!;

      expect(higher.storedItems).toBeGreaterThanOrEqual(lower.storedItems);
      expect(higher.insuredShipments).toBeGreaterThanOrEqual(lower.insuredShipments);
      expect(higher.insuredValueCapMinor).toBeGreaterThanOrEqual(lower.insuredValueCapMinor);
      expect(higher.postageCreditMinor).toBeGreaterThanOrEqual(lower.postageCreditMinor);
      expect(higher.commissionWaivedOnMinor).toBeGreaterThanOrEqual(lower.commissionWaivedOnMinor);

      for (const [action, allowed] of Object.entries(lower.perCycle)) {
        const above = higher.perCycle[action];
        expect(above, `${higher.key} dropped ${action}`).toBeDefined();
        if (allowed !== UNLIMITED && above !== UNLIMITED) {
          expect(above).toBeGreaterThanOrEqual(allowed);
        }
      }
      // And every perk survives the upgrade.
      for (const perk of lower.perks) expect(higher.perks).toContain(perk);
    }
  });

  it('every allowance has a ceiling, so the worst case is a number', () => {
    // This is the whole basis of a fixed monthly fee being safe to sell: not one
    // unbounded promise anywhere. `UNLIMITED` is allowed only on actions whose
    // real limit is a person doing them by hand.
    const boundedByHand = new Set(['parcel_processing', 'parcel_forwarding', 'service_fee:deslab']);
    for (const tier of MEMBERSHIP_TIERS) {
      expect(tier.storedItems).toBeGreaterThan(0);
      expect(tier.insuredShipments).toBeGreaterThan(0);
      expect(tier.insuredValueCapMinor).toBeGreaterThan(0);
      for (const [action, allowed] of Object.entries(tier.perCycle)) {
        if (allowed === UNLIMITED) {
          expect(boundedByHand.has(action), `${tier.key} is unlimited on ${action}`).toBe(true);
        } else {
          expect(allowed).toBeGreaterThan(0);
        }
      }
    }
  });

  it('is priced below its own worst case, but not absurdly below', () => {
    // Each tier should sit at roughly two thirds of what it would cost Bault if
    // a member used every allowance every cycle. Far above that and the tier is
    // not worth buying; far below and it is not worth selling.
    for (const tier of MEMBERSHIP_TIERS) {
      const worstCase = fullUseCostMinor(tier, UNIT_PRICES);
      const utilisation = tier.listPriceMinor / worstCase;
      expect(utilisation, `${tier.key} break-even utilisation`).toBeGreaterThan(0.4);
      expect(utilisation, `${tier.key} break-even utilisation`).toBeLessThan(0.9);
    }
  });
});

describe('what a tier covers right now', () => {
  const folio = membershipTier('folio')!;

  it('covers an action until the allowance is spent, and then simply does not', () => {
    expect(covers(folio, 'intake', 0)).toBe(true);
    expect(covers(folio, 'intake', 3)).toBe(true);
    // The fourth is the last one included.
    expect(remaining(folio, 'intake', 3)).toBe(1);
    expect(covers(folio, 'intake', 4)).toBe(false);
    expect(remaining(folio, 'intake', 4)).toBe(0);
    // And never goes negative, however many were somehow consumed.
    expect(remaining(folio, 'intake', 99)).toBe(0);
  });

  it('treats "not in this tier" and "used up" as the same answer on purpose', () => {
    // Both mean: this will be charged, at its ordinary price, after the member
    // approves it. Nothing downstream needs to tell them apart.
    expect(covers(folio, 'service_fee:video_review', 0)).toBe(false);
    expect(remaining(folio, 'service_fee:video_review', 0)).toBe(0);
  });

  it('an unlimited allowance stays unlimited however much is used', () => {
    const trust = membershipTier('trust')!;
    expect(remaining(trust, 'service_fee:deslab', 0)).toBe(UNLIMITED);
    expect(remaining(trust, 'service_fee:deslab', 500)).toBe(UNLIMITED);
    expect(covers(trust, 'service_fee:deslab', 500)).toBe(true);
  });

  it('resolves tier keys and refuses anything else', () => {
    expect(isTierKey('registry')).toBe(true);
    expect(isTierKey('platinum')).toBe(false);
    expect(membershipTier('platinum')).toBeUndefined();
    expect(membershipTier(null)).toBeUndefined();
  });
});

describe('what is published as not covered', () => {
  it('names the pass-throughs and the penalties, and nothing a tier covers', () => {
    // These are the three lines that are other people's money plus the two that
    // are consequences rather than services. If one of them ever appears in a
    // tier's `perCycle`, one of the two lists is wrong.
    expect(UNCOVERED).toContain('carrier_postage_above_credit');
    expect(UNCOVERED).toContain('grading_fees');
    expect(UNCOVERED).toContain('white_glove');
    expect(UNCOVERED).toContain('chargeback_fee');

    const covered = new Set(MEMBERSHIP_TIERS.flatMap((t) => Object.keys(t.perCycle)));
    for (const key of UNCOVERED) expect(covered.has(key)).toBe(false);
  });
});
