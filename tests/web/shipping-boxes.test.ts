import { describe, it, expect } from 'vitest';
import { SHIPPING_BOXES, checkBox, chooseBox, shippingBox } from '../../apps/api/src/modules/shp/boxes';
import { DIM_DIVISOR, dimensionalGrams } from '../../packages/adapters/src/shipping';

/**
 * Where a parcel's dimensions come from.
 *
 * The question this pins is the one everybody asks when they first read the
 * quoting code: *how can it bill dimensional weight when nobody measured
 * anything at intake?*
 *
 * The answer is that nothing is ever measured. An item contributes only its
 * WEIGHT — from a scale at the bench, or the typical figure for its class. The
 * DIMENSIONS are the box's, and there are five boxes, and their sizes are
 * constants. So the chain is class + weight → the smallest box that fits →
 * that box's known L×W×H → dimensional weight → the price.
 *
 * `chooseBox` is the middle step, and it is the step that did not exist: an
 * unchosen box used to mean no dimensions at all, so a light parcel in a large
 * box was quoted as if volume were free.
 */

describe('dimensional weight', () => {
  it('uses the divisor the reference service publishes', () => {
    // Their FAQ states the formula as (L × W × H) / 167 and quotes prices
    // against it. It was 139 here — the pricier domestic retail figure — which
    // over-quoted every boxed parcel by about a fifth.
    expect(DIM_DIVISOR).toBe(167);
  });

  it('is zero when no box is known, which is the honest answer', () => {
    // No dimensions means no volume to bill, so the parcel prices on weight
    // alone. That is under-quoting, and it is exactly why a box is chosen.
    expect(dimensionalGrams(undefined)).toBe(0);
  });

  it('grows with volume, so a bigger box bills more at the same weight', () => {
    const mailer = dimensionalGrams({ length: 25, width: 18, height: 3 });
    const medium = dimensionalGrams({ length: 33, width: 25, height: 15 });
    const large = dimensionalGrams({ length: 45, width: 35, height: 25 });

    expect(mailer).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);

    // A medium box has a floor of about 2.5 kg however little is inside it.
    // Two graded slabs weigh 120 g; the box is what gets billed.
    expect(medium).toBeGreaterThan(2_000);
    expect(medium).toBeLessThan(3_000);
  });
});

describe('choosing the box the warehouse would', () => {
  it('takes the smallest one that fits, because every extra cm³ is paid for', () => {
    const twoSlabs = chooseBox({ totalWeightGrams: 120, typeClasses: ['graded_slab', 'graded_slab'] });
    expect(twoSlabs?.key).toBe('rigid_mailer');
  });

  it('steps up when the weight will not fit the smaller one', () => {
    // The rigid mailer is rated to 500 g.
    expect(chooseBox({ totalWeightGrams: 480, typeClasses: ['graded_slab'] })?.key).toBe('rigid_mailer');
    expect(chooseBox({ totalWeightGrams: 520, typeClasses: ['graded_slab'] })?.key).toBe('small');
  });

  it('steps up when the CLASS will not fit, whatever it weighs', () => {
    // A sealed case is oversized: neither the mailer nor the small box takes
    // one, and the mailer only takes cards, slabs and packs at all.
    const sealedCase = chooseBox({ totalWeightGrams: 200, typeClasses: ['sealed_case'] });
    expect(sealedCase?.key).toBe('medium');
    expect(sealedCase?.takesOversized).toBe(true);
  });

  it('answers undefined rather than silently reaching for the biggest box', () => {
    // Over the largest box's rating. The caller surfaces this as a problem; a
    // box that cannot hold the contents is not a box, and quoting one would be
    // quoting a parcel that cannot be packed.
    expect(chooseBox({ totalWeightGrams: 40_000, typeClasses: ['memorabilia'] })).toBeUndefined();
  });

  it('never picks a box its own rules would then refuse', () => {
    // The property that matters: whatever comes back must pass `checkBox`, or
    // the quote and the packing bench disagree about the same parcel.
    const cases = [
      { totalWeightGrams: 60, typeClasses: ['graded_slab'] },
      { totalWeightGrams: 1_500, typeClasses: ['sealed_box', 'trading_card'] },
      { totalWeightGrams: 6_000, typeClasses: ['sealed_case'] },
      { totalWeightGrams: 12_000, typeClasses: ['memorabilia', 'comic_graded'] },
    ];
    for (const contents of cases) {
      const box = chooseBox(contents);
      expect(box, JSON.stringify(contents)).toBeDefined();
      expect(checkBox(box, contents)).toEqual([]);
    }
  });

  it('every box in the catalogue is reachable by some parcel', () => {
    // A box nothing can ever be assigned to is dead weight in the catalogue and
    // a rule nobody is enforcing.
    const reachable = new Set(
      [
        chooseBox({ totalWeightGrams: 100, typeClasses: ['graded_slab'] }),
        chooseBox({ totalWeightGrams: 1_000, typeClasses: ['small_collectible'] }),
        chooseBox({ totalWeightGrams: 5_000, typeClasses: ['sealed_case'] }),
        chooseBox({ totalWeightGrams: 12_000, typeClasses: ['memorabilia'] }),
        chooseBox({ totalWeightGrams: 25_000, typeClasses: ['memorabilia'] }),
      ].map((b) => b?.key),
    );
    for (const box of SHIPPING_BOXES) expect(reachable, box.key).toContain(box.key);
  });

  it('an explicit choice is still a choice', () => {
    // Auto-selection is the default, not a policy. Somebody who wants their card
    // in a bigger box for their own reasons may have one.
    expect(shippingBox('large')?.key).toBe('large');
    expect(shippingBox(null)).toBeUndefined();
  });
});
