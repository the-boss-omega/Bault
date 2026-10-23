export interface Region {
  code: string;
  name: string;
}

export const REGION_MAX = 60;

const US_REGIONS: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
  AA: 'Armed Forces Americas',
  AE: 'Armed Forces Europe',
  AP: 'Armed Forces Pacific',
};

const CA_REGIONS: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

const REQUIRED: Record<string, { regions: Record<string, string>; noun: 'state' | 'province' }> = {
  US: { regions: US_REGIONS, noun: 'state' },
  CA: { regions: CA_REGIONS, noun: 'province' },
};

export function regionRequired(country: string): boolean {
  return Boolean(REQUIRED[country.trim().toUpperCase()]);
}

export function regionsOf(country: string): Region[] | undefined {
  const rule = REQUIRED[country.trim().toUpperCase()];
  if (!rule) return undefined;
  return Object.entries(rule.regions).map(([code, name]) => ({ code, name }));
}

export function normalizeRegion(
  country: string,
  value: string | null | undefined,
): { region: string | null } | { problem: string } {
  const raw = (value ?? '').trim();
  const rule = REQUIRED[country.trim().toUpperCase()];
  if (!rule) {
    if (raw.length > REGION_MAX) return { problem: `A state or region is at most ${REGION_MAX} characters` };
    return { region: raw || null };
  }
  const code = raw.toUpperCase();
  if (!code) {
    return { problem: `Choose the ${rule.noun}: carriers will not ship to ${country.toUpperCase()} without it` };
  }
  if (!rule.regions[code]) {
    return { problem: `"${raw}" is not a ${country.toUpperCase()} ${rule.noun}; use its two-letter code (NY, ON)` };
  }
  return { region: code };
}
