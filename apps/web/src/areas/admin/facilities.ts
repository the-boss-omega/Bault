/** A facility as the administrator reads it (what `GET /admin/facilities` answers). */
export interface AdminFacility {
  id: string;
  code: string;
  name: string;
  role: 'primary' | 'forwarding';
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string | null;
  salesTaxBps: number;
  forwardsToFacilityId: string | null;
  forwardsToCode: string | null;
  forwardingDays: number | null;
  active: boolean;
  /** Its first line is still the seed's stand-in: customers are not shown it in production and nothing ships from it. */
  placeholder: boolean;
}

/** What is typed into the form: every field as text, as it is typed. */
export interface FacilityDraft {
  code: string;
  name: string;
  role: 'primary' | 'forwarding';
  line1: string;
  line2: string;
  city: string;
  country: string;
  region: string;
  postalCode: string;
  phone: string;
  /** A percentage, as written: "6.63". The server keeps it in hundredths of a percent. */
  taxPercent: string;
  forwardsTo: string;
  days: string;
}

export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,7}$/;
export const DEFAULT_COUNTRY = 'US';
/** The tax rate the server accepts, in hundredths of a percent. */
export const MAX_TAX_BPS = 2500;
export const MAX_FORWARDING_DAYS = 60;

/** 663 is written 6.63; 500 is written 5; nothing is written 0. */
export function bpsToPercent(bps: number): string {
  return String(bps / 100);
}

/** "6.63" is 663. A rate with a third decimal, a sign, or a letter in it is not one the server can keep, and is null. */
export function percentToBps(text: string): number | null {
  const typed = text.trim();
  if (typed === '') return 0;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(typed)) return null;
  const bps = Math.round(Number(typed) * 100);
  return bps <= MAX_TAX_BPS ? bps : null;
}

export function draftOf(facility: AdminFacility | null): FacilityDraft {
  if (!facility) {
    return {
      code: '',
      name: '',
      role: 'primary',
      line1: '',
      line2: '',
      city: '',
      country: DEFAULT_COUNTRY,
      region: '',
      postalCode: '',
      phone: '',
      taxPercent: '0',
      forwardsTo: '',
      days: '',
    };
  }
  return {
    code: facility.code,
    name: facility.name,
    role: facility.role,
    line1: facility.placeholder ? '' : facility.line1,
    line2: facility.line2 ?? '',
    city: facility.city,
    country: facility.country,
    region: facility.region,
    // The seed's stand-in has a stand-in postcode too (00000): it is written over with the real one.
    postalCode: facility.placeholder ? '' : facility.postalCode,
    phone: facility.phone ?? '',
    taxPercent: bpsToPercent(facility.salesTaxBps),
    forwardsTo: facility.forwardsToFacilityId ?? '',
    days: facility.forwardingDays == null ? '' : String(facility.forwardingDays),
  };
}

/** The fields that are not yet right, by name. A form that has none is ready to send. */
export function problemsOf(
  draft: FacilityDraft,
  options: { isNew: boolean; regionNeeded: boolean },
): (keyof FacilityDraft)[] {
  const problems: (keyof FacilityDraft)[] = [];
  const filled = (value: string) => value.trim() !== '';
  if (options.isNew && !CODE_PATTERN.test(draft.code.trim().toUpperCase())) problems.push('code');
  if (!filled(draft.name)) problems.push('name');
  if (!filled(draft.line1)) problems.push('line1');
  if (!filled(draft.city)) problems.push('city');
  if (!filled(draft.country)) problems.push('country');
  if (options.regionNeeded && !filled(draft.region)) problems.push('region');
  if (!filled(draft.postalCode)) problems.push('postalCode');
  if (percentToBps(draft.taxPercent) === null) problems.push('taxPercent');
  if (draft.role === 'forwarding') {
    if (!filled(draft.forwardsTo)) problems.push('forwardsTo');
    const days = Number(draft.days);
    if (!filled(draft.days) || !Number.isInteger(days) || days < 1 || days > MAX_FORWARDING_DAYS) {
      problems.push('days');
    }
  }
  return problems;
}

/** What is sent to make a facility: only what it has; a forwarding facility's two settings go with it. */
export function newFacilityBody(draft: FacilityDraft) {
  return {
    code: draft.code.trim().toUpperCase(),
    role: draft.role,
    ...changesBody(draft, draft.role),
  };
}

/** What is sent to change one: every field the server lets change, as it now stands in the form. */
export function changesBody(draft: FacilityDraft, role: 'primary' | 'forwarding') {
  return {
    name: draft.name.trim(),
    line1: draft.line1.trim(),
    line2: draft.line2.trim() || null,
    city: draft.city.trim(),
    region: draft.region.trim(),
    postalCode: draft.postalCode.trim(),
    country: draft.country.trim(),
    phone: draft.phone.trim() || null,
    salesTaxBps: percentToBps(draft.taxPercent) ?? 0,
    ...(role === 'forwarding'
      ? { forwardsToFacilityId: draft.forwardsTo, forwardingDays: Number(draft.days) }
      : {}),
  };
}

/** Whether the form still says what the facility says (or, for a new one, is still blank): nothing to save. */
export function isUnchanged(draft: FacilityDraft, facility: AdminFacility | null): boolean {
  const original = draftOf(facility);
  // A stand-in address is shown as an empty line, to be written over: it is not an edit to leave it so, and it is not saved as one.
  const keys = Object.keys(original) as (keyof FacilityDraft)[];
  return keys.every((key) => draft[key].trim() === original[key].trim());
}

/**
 * The address as a customer is given it, written as it is typed: the lines `addressLines` makes of the facility
 * once it is saved, with the care-of line that has the customer's own username in it (here, the word).
 */
export function previewLines(draft: FacilityDraft): string[] {
  const place = [
    draft.city.trim(),
    [draft.region.trim(), draft.postalCode.trim()].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return [
    'Bault C/O username',
    draft.line1.trim(),
    draft.line2.trim(),
    place,
    draft.country.trim(),
  ].filter(Boolean);
}
