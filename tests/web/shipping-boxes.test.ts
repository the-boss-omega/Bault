import { describe, it, expect } from 'vitest';
import { SHIPPING_BOXES, checkBox, chooseBox, shippingBox } from '../../apps/api/src/modules/shp/boxes';
import { DIM_DIVISOR, billableGrams, dimensionalGrams } from '../../packages/adapters/src/shipping';
import { CARRIER_SERVICES, carrierService, checkService, destinationOf } from '../../apps/api/src/modules/shp/carriers';

describe('dimensional weight', () => {
  it('uses the divisor the reference service publishes', () => {
    expect(DIM_DIVISOR).toBe(167);
  });

  it('is zero when no box is known, which is the honest answer', () => {
    expect(dimensionalGrams(undefined)).toBe(0);
  });

  it('grows with volume, so a bigger box bills more at the same weight', () => {
    const mailer = dimensionalGrams({ length: 25, width: 18, height: 3 });
    const medium = dimensionalGrams({ length: 33, width: 25, height: 15 });
    const large = dimensionalGrams({ length: 45, width: 35, height: 25 });

    expect(mailer).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);

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
    expect(chooseBox({ totalWeightGrams: 480, typeClasses: ['graded_slab'] })?.key).toBe('rigid_mailer');
    expect(chooseBox({ totalWeightGrams: 520, typeClasses: ['graded_slab'] })?.key).toBe('small');
  });

  it('steps up when the CLASS will not fit, whatever it weighs', () => {
    const sealedCase = chooseBox({ totalWeightGrams: 200, typeClasses: ['sealed_case'] });
    expect(sealedCase?.key).toBe('medium');
    expect(sealedCase?.takesOversized).toBe(true);
  });

  it('answers undefined rather than silently reaching for the biggest box', () => {
    expect(chooseBox({ totalWeightGrams: 40_000, typeClasses: ['memorabilia'] })).toBeUndefined();
  });

  it('never picks a box its own rules would then refuse', () => {
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
    expect(shippingBox('large')?.key).toBe('large');
    expect(shippingBox(null)).toBeUndefined();
  });
});

describe('billing in whole units', () => {
  it('rounds UP to the service unit, so a fraction of a pound costs a pound', () => {
    expect(billableGrams(460, 0, 'pound')).toBeCloseTo(2 * 453.592, 1);
    expect(billableGrams(453.592, 0, 'pound')).toBeCloseTo(453.592, 1);
  });

  it('bills at least one whole unit, because nobody ships a zero-ounce parcel', () => {
    expect(billableGrams(1, 0, 'ounce')).toBeCloseTo(28.3495, 2);
  });

  it('compares first and rounds second', () => {
    const dim = dimensionalGrams({ length: 33, width: 25, height: 15 });
    expect(billableGrams(100, dim, 'pound')).toBeCloseTo(Math.ceil(dim / 453.592) * 453.592, 1);
  });

  it('leaves the flat-rate service alone', () => {
    expect(billableGrams(1_234, 0, 'continuous')).toBe(1_234);
    expect(carrierService('direct_overnight')!.billingIncrement).toBe('continuous');
  });

  it('publishes a unit for every service, so nothing meters by accident', () => {
    for (const service of CARRIER_SERVICES) {
      expect(['ounce', 'pound', 'continuous'], service.key).toContain(service.billingIncrement);
    }
  });
});

describe('the limits a box can break on its own', () => {
  const parcel = (dims: { length: number; width: number; height: number }) => ({
    destination: { country: 'DE', postalCode: '10115' },
    weightGrams: 200,
    dimensionsCm: dims,
    packagingGrams: 60,
    itemCount: 1,
    customsValueMinor: 10_000,
    insuredValueMinor: 0,
    signatureRequired: false,
    originFacilityCode: 'NJ',
  });

  it('refuses ePacket for a box over its 36-inch total, before anything is in it', () => {
    const problems = checkService(carrierService('epacket')!, parcel({ length: 45, width: 35, height: 25 }));
    const dimensions = problems.filter((p) => p.rule === 'dimensions');
    expect(dimensions).toHaveLength(1);
    expect(dimensions[0]!.message).toMatch(/length, width and height added together/i);
    expect(dimensions[0]!.limit).toBe('36 in');
  });

  it('accepts ePacket for the boxes that genuinely fit', () => {
    for (const dims of [
      { length: 25, width: 18, height: 3 },
      { length: 23, width: 18, height: 10 },
      { length: 33, width: 25, height: 15 },
    ]) {
      const problems = checkService(carrierService('epacket')!, parcel(dims));
      expect(problems.filter((p) => p.rule === 'dimensions'), JSON.stringify(dims)).toEqual([]);
    }
  });

  it('says nothing about dimensions on services that publish no limit', () => {
    const problems = checkService(carrierService('epost')!, parcel({ length: 60, width: 45, height: 40 }));
    expect(problems.filter((p) => p.rule === 'dimensions')).toEqual([]);
  });

  it('checks nothing when no box is known, rather than refusing on a missing number', () => {
    const { dimensionsCm, ...noBox } = parcel({ length: 45, width: 35, height: 25 });
    void dimensionsCm;
    const problems = checkService(carrierService('epacket')!, noBox);
    expect(problems.filter((p) => p.rule === 'dimensions')).toEqual([]);
  });
});

describe('where a stored shipment is going', () => {
  it('uses the frozen address, street and all, when there is one', () => {
    const d = destinationOf({
      destinationDetail: { country: 'US', postalCode: '07030', street1: '1 River St', city: 'Hoboken', name: 'Red' },
      destinationCountry: 'US',
      destinationPostalCode: '07030',
    });
    expect(d.street1).toBe('1 River St');
    expect(d.city).toBe('Hoboken');
  });

  it('falls back to what an older shipment recorded, and never invents a street', () => {
    const d = destinationOf({
      destinationDetail: null,
      destinationCountry: 'DE',
      destinationPostalCode: '10115',
      recipientName: 'Golden',
    });
    expect(d).toEqual({ country: 'DE', postalCode: '10115', name: 'Golden' });
  });
});
