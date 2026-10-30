import { describe, it, expect } from 'vitest';
import {
  CODE_PATTERN,
  bpsToPercent,
  changesBody,
  draftOf,
  isUnchanged,
  newFacilityBody,
  percentToBps,
  previewLines,
  problemsOf,
  type AdminFacility,
  type FacilityDraft,
} from '../../apps/web/src/areas/admin/facilities';
import { addressLines } from '../../apps/web/src/shared/parcels';

const FACILITY: AdminFacility = {
  id: 'f1',
  code: 'OR',
  name: 'Bault Oregon',
  role: 'primary',
  line1: '12 Pier Road',
  line2: 'Dock 3',
  city: 'Portland',
  region: 'OR',
  postalCode: '97201',
  country: 'US',
  phone: '+1 503 555 0100',
  salesTaxBps: 0,
  forwardsToFacilityId: null,
  forwardsToCode: null,
  forwardingDays: null,
  active: true,
  placeholder: false,
};

const STAND_IN: AdminFacility = {
  ...FACILITY,
  code: 'NJ',
  name: 'Bault New Jersey',
  line1: 'SET REAL ADDRESS — placeholder',
  line2: null,
  city: 'Newark',
  region: 'NJ',
  postalCode: '00000',
  salesTaxBps: 663,
  placeholder: true,
};

const typed = (change: Partial<FacilityDraft>): FacilityDraft => ({ ...draftOf(null), ...change });
const FILLED = typed({
  code: 'nj2',
  name: 'Bault Newark Annex',
  line1: '500 Harbor Way',
  city: 'Elizabeth',
  region: 'NJ',
  postalCode: '07201',
});

describe('a tax rate, as it is written and as it is kept', () => {
  it('is a percentage in the form and hundredths of a percent on the server', () => {
    expect(percentToBps('6.63')).toBe(663);
    expect(percentToBps('5')).toBe(500);
    expect(percentToBps('0')).toBe(0);
    expect(percentToBps('')).toBe(0);
    expect(percentToBps(' 25 ')).toBe(2500);
    expect(percentToBps('0.05')).toBe(5);
    expect(bpsToPercent(663)).toBe('6.63');
    expect(bpsToPercent(500)).toBe('5');
    expect(bpsToPercent(0)).toBe('0');
  });

  it('is not a rate when it has a third decimal, a sign, a letter or more than the server keeps', () => {
    for (const text of ['6.625', '-1', '+5', '6,5', 'six', '25.01', '26', '100', '.5', '5.']) {
      expect(percentToBps(text), text).toBeNull();
    }
  });

  it('comes back as it went', () => {
    for (const bps of [0, 1, 50, 663, 1000, 2500])
      expect(percentToBps(bpsToPercent(bps))).toBe(bps);
  });
});

describe('a facility’s code', () => {
  it('is two to eight letters, digits or hyphens, beginning with a letter or a digit', () => {
    for (const code of ['NJ', 'DE', 'NJ2', 'ZT-1', 'A1B2C3D4'])
      expect(CODE_PATTERN.test(code), code).toBe(true);
    for (const code of ['N', '', '-NJ', 'NJ 2', 'NJ_2', 'ABCDEFGHI', 'נג'])
      expect(CODE_PATTERN.test(code), code).toBe(false);
  });
});

describe('the form, begun and filled', () => {
  it('begins blank, a primary facility in the country the product is run from, at no tax', () => {
    expect(draftOf(null)).toEqual({
      code: '',
      name: '',
      role: 'primary',
      line1: '',
      line2: '',
      city: '',
      country: 'US',
      region: '',
      postalCode: '',
      phone: '',
      taxPercent: '0',
      forwardsTo: '',
      days: '',
    });
  });

  it('begins as the facility is, but with the seed’s stand-in street and postcode left empty to be written over', () => {
    expect(draftOf(FACILITY)).toMatchObject({
      line1: '12 Pier Road',
      line2: 'Dock 3',
      postalCode: '97201',
      phone: '+1 503 555 0100',
    });
    expect(draftOf(STAND_IN)).toMatchObject({
      line1: '',
      postalCode: '',
      city: 'Newark',
      region: 'NJ',
      taxPercent: '6.63',
    });
  });

  it('says what is not yet right, by field, and nothing of a form that is ready', () => {
    const options = { isNew: true, regionNeeded: true };
    expect(problemsOf(draftOf(null), options)).toEqual([
      'code',
      'name',
      'line1',
      'city',
      'region',
      'postalCode',
    ]);
    expect(problemsOf(FILLED, options)).toEqual([]);
    expect(problemsOf(typed({ ...FILLED, code: 'x' }), options)).toEqual(['code']);
    expect(problemsOf(typed({ ...FILLED, taxPercent: '6.625' }), options)).toEqual(['taxPercent']);
    expect(problemsOf(typed({ ...FILLED, line1: '   ' }), options)).toEqual(['line1']);
  });

  it('asks for a state only where the country has them, and for a code only of a new facility', () => {
    expect(
      problemsOf(typed({ ...FILLED, region: '' }), { isNew: true, regionNeeded: true }),
    ).toEqual(['region']);
    expect(
      problemsOf(typed({ ...FILLED, region: '' }), { isNew: true, regionNeeded: false }),
    ).toEqual([]);
    expect(
      problemsOf(typed({ ...FILLED, code: '' }), { isNew: false, regionNeeded: true }),
    ).toEqual([]);
  });

  it('asks a forwarding facility where it forwards to and for how many days, one to sixty, whole', () => {
    const forwarding = typed({ ...FILLED, role: 'forwarding' });
    const options = { isNew: true, regionNeeded: true };
    expect(problemsOf(forwarding, options)).toEqual(['forwardsTo', 'days']);
    for (const days of ['0', '61', '2.5', 'x', '']) {
      expect(problemsOf({ ...forwarding, forwardsTo: 'f1', days }, options), days).toEqual([
        'days',
      ]);
    }
    expect(problemsOf({ ...forwarding, forwardsTo: 'f1', days: '3' }, options)).toEqual([]);
    expect(problemsOf({ ...forwarding, forwardsTo: 'f1', days: '60' }, options)).toEqual([]);
  });
});

describe('what is sent', () => {
  it('to make a primary facility: its code in capitals, what it has, and no forwarding settings', () => {
    expect(
      newFacilityBody({ ...FILLED, line2: ' Dock 4 ', phone: '', taxPercent: '6.63' }),
    ).toEqual({
      code: 'NJ2',
      role: 'primary',
      name: 'Bault Newark Annex',
      line1: '500 Harbor Way',
      line2: 'Dock 4',
      city: 'Elizabeth',
      region: 'NJ',
      postalCode: '07201',
      country: 'US',
      phone: null,
      salesTaxBps: 663,
    });
  });

  it('to make a forwarding facility: the two settings go with it', () => {
    const body = newFacilityBody({ ...FILLED, role: 'forwarding', forwardsTo: 'f1', days: '3' });
    expect(body).toMatchObject({
      role: 'forwarding',
      forwardsToFacilityId: 'f1',
      forwardingDays: 3,
    });
  });

  it('to change one: every field the server lets change, and not its code or role', () => {
    const body = changesBody(draftOf(FACILITY), 'primary');
    expect(Object.keys(body).sort()).toEqual([
      'city',
      'country',
      'line1',
      'line2',
      'name',
      'phone',
      'postalCode',
      'region',
      'salesTaxBps',
    ]);
    expect(
      changesBody(
        draftOf({ ...FACILITY, role: 'forwarding', forwardsToFacilityId: 'f9', forwardingDays: 4 }),
        'forwarding',
      ),
    ).toMatchObject({
      forwardsToFacilityId: 'f9',
      forwardingDays: 4,
    });
  });

  it('clears an optional line that was emptied, by sending nothing for it', () => {
    expect(changesBody({ ...draftOf(FACILITY), line2: '  ', phone: '' }, 'primary')).toMatchObject({
      line2: null,
      phone: null,
    });
  });
});

describe('whether there is anything to save', () => {
  it('is not, for a form that still says what the facility says, nor for a blank new one', () => {
    expect(isUnchanged(draftOf(FACILITY), FACILITY)).toBe(true);
    expect(isUnchanged({ ...draftOf(FACILITY), name: ' Bault Oregon ' }, FACILITY)).toBe(true);
    expect(isUnchanged(draftOf(null), null)).toBe(true);
    // The stand-in is shown empty: leaving it so is not an edit.
    expect(isUnchanged(draftOf(STAND_IN), STAND_IN)).toBe(true);
  });

  it('is, as soon as a field differs', () => {
    expect(isUnchanged({ ...draftOf(FACILITY), city: 'Salem' }, FACILITY)).toBe(false);
    expect(isUnchanged({ ...draftOf(STAND_IN), line1: '77 Real Street' }, STAND_IN)).toBe(false);
    expect(isUnchanged(typed({ name: 'x' }), null)).toBe(false);
  });
});

describe('the address as a customer is given it', () => {
  it('is the lines the product gives a customer once the facility is saved', () => {
    const draft = draftOf(FACILITY);
    const saved = addressLines({
      facilityId: FACILITY.id,
      code: FACILITY.code,
      name: FACILITY.name,
      role: FACILITY.role,
      careOf: 'Bault C/O username',
      lines: [FACILITY.line1, FACILITY.line2!],
      city: FACILITY.city,
      region: FACILITY.region,
      postalCode: FACILITY.postalCode,
      country: FACILITY.country,
      phone: FACILITY.phone,
      salesTaxBps: FACILITY.salesTaxBps,
      forwardingDays: null,
    });
    expect(previewLines(draft)).toEqual(saved);
  });

  it('leaves out the lines that are not yet written, and has the care-of line from the start', () => {
    expect(previewLines(draftOf(null))).toEqual(['Bault C/O username', 'US']);
    expect(previewLines(typed({ city: 'Elizabeth' }))).toEqual([
      'Bault C/O username',
      'Elizabeth',
      'US',
    ]);
    expect(previewLines(typed({ city: 'Elizabeth', region: 'NJ' }))).toEqual([
      'Bault C/O username',
      'Elizabeth, NJ',
      'US',
    ]);
    expect(previewLines(typed({ region: 'NJ', postalCode: '07201' }))).toEqual([
      'Bault C/O username',
      'NJ 07201',
      'US',
    ]);
  });
});
