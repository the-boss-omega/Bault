import { CARRIER_SERVICES, DOMESTIC_COUNTRY } from './carriers';

/**
 * Where a parcel can be addressed, as a code and a name.
 *
 * Every carrier rule reads `country` as an ISO 3166-1 alpha-2 code: `carriers.ts`
 * compares it with `DOMESTIC_COUNTRY` and with each service's `countries` list,
 * so a display name such as "Israel" would be routed as international and then
 * refused by a service that does reach `IL`. This list is served to the address
 * form, which is a select. It is derived from the carrier table so it cannot
 * drift from the services that actually reach each destination.
 */

export interface ShippingCountry {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  name: string;
  /** True for the country the facilities are in; its rates are the cheap ones. */
  domestic: boolean;
}

/**
 * Names for the codes the carriers name.
 *
 * English only, and deliberately: the SPA translates the sentence around a
 * destination and keeps the place, exactly as it does for carrier limits. A
 * half-translated list where some countries appear in Hebrew and some do not
 * would be worse than one that is consistently in one language.
 */
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  AU: 'Australia',
  AT: 'Austria',
  BE: 'Belgium',
  BR: 'Brazil',
  CA: 'Canada',
  CH: 'Switzerland',
  CN: 'China',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  HK: 'Hong Kong',
  HU: 'Hungary',
  IE: 'Ireland',
  IL: 'Israel',
  IT: 'Italy',
  JP: 'Japan',
  KR: 'South Korea',
  LU: 'Luxembourg',
  MX: 'Mexico',
  MY: 'Malaysia',
  NL: 'Netherlands',
  NO: 'Norway',
  NZ: 'New Zealand',
  PL: 'Poland',
  PT: 'Portugal',
  SE: 'Sweden',
  SG: 'Singapore',
};

/**
 * Every country at least one contracted service reaches.
 *
 * A service with an empty `countries` list reaches anywhere in its scope, so it
 * cannot enumerate destinations; the named lists do, and the union of those plus
 * the domestic country is what can be offered without promising a route that
 * does not exist. Sorted with home first, then alphabetically by name, because
 * that is the order somebody scans.
 */
export function shippingCountries(): ShippingCountry[] {
  const codes = new Set<string>([DOMESTIC_COUNTRY]);
  for (const service of CARRIER_SERVICES) {
    for (const code of service.countries) codes.add(code);
  }
  const rows = [...codes]
    .filter((code) => COUNTRY_NAMES[code])
    .map((code) => ({
      code,
      name: COUNTRY_NAMES[code]!,
      domestic: code === DOMESTIC_COUNTRY,
    }));
  rows.sort((a, b) => (a.domestic === b.domestic ? a.name.localeCompare(b.name) : a.domestic ? -1 : 1));
  return rows;
}

/** Whether a stored value is a code this platform can actually ship to. */
export function isShippableCountry(value: string): boolean {
  return shippingCountries().some((c) => c.code === value.trim().toUpperCase());
}

/**
 * Normalise what a caller sent into a code, or return null.
 *
 * Accepts the code in any casing, and accepts a full country NAME, because a
 * caller who sends "United States" for a field that wants "US" has said
 * something unambiguous rather than something wrong.
 */
export function toCountryCode(value: string): string | null {
  const raw = value.trim();
  const upper = raw.toUpperCase();
  if (COUNTRY_NAMES[upper]) return upper;
  const byName = Object.entries(COUNTRY_NAMES).find(([, name]) => name.toLowerCase() === raw.toLowerCase());
  return byName ? byName[0] : null;
}
