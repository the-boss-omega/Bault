import { CARRIER_SERVICES, DOMESTIC_COUNTRY } from './carriers';
import { regionRequired, regionsOf, type Region } from './regions';

export interface ShippingCountry {
  code: string;
  name: string;
  domestic: boolean;
  regionRequired: boolean;
  regions?: Region[];
}

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

export function shippingCountries(): ShippingCountry[] {
  const codes = new Set<string>([DOMESTIC_COUNTRY]);
  for (const service of CARRIER_SERVICES) {
    for (const code of service.countries) codes.add(code);
  }
  const rows = [...codes]
    .filter((code) => COUNTRY_NAMES[code])
    .map((code) => {
      const regions = regionsOf(code);
      return {
        code,
        name: COUNTRY_NAMES[code]!,
        domestic: code === DOMESTIC_COUNTRY,
        regionRequired: regionRequired(code),
        ...(regions ? { regions } : {}),
      };
    });
  rows.sort((a, b) => (a.domestic === b.domestic ? a.name.localeCompare(b.name) : a.domestic ? -1 : 1));
  return rows;
}

export function isShippableCountry(value: string): boolean {
  return shippingCountries().some((c) => c.code === value.trim().toUpperCase());
}

export function toCountryCode(value: string): string | null {
  const raw = value.trim();
  const upper = raw.toUpperCase();
  if (COUNTRY_NAMES[upper]) return upper;
  const byName = Object.entries(COUNTRY_NAMES).find(([, name]) => name.toLowerCase() === raw.toLowerCase());
  return byName ? byName[0] : null;
}
