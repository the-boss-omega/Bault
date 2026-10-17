import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * The destinations an address may name.
 *
 * Fetched, not duplicated: the server derives the list from the carrier
 * contracts, so a copy here would go stale. Every rule in `carriers.ts` reads an
 * address's country as an ISO 3166-1 alpha-2 code, never a country name.
 */
export interface ShippingCountry {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  name: string;
  /** The country the facilities are in, whose rates are the cheap ones. */
  domestic: boolean;
}

let cached: Promise<ShippingCountry[]> | null = null;

export function useShippingCountries(): ShippingCountry[] {
  const [rows, setRows] = useState<ShippingCountry[]>([]);
  useEffect(() => {
    let live = true;
    cached ??= api.get<ShippingCountry[]>('/shipping/countries').catch(() => {
      // Clearing the cache lets the next form try again rather than pinning a
      // transient failure for the rest of the session.
      cached = null;
      return [];
    });
    void cached.then((list) => {
      if (live) setRows(list);
    });
    return () => {
      live = false;
    };
  }, []);
  return rows;
}

/**
 * The readable name for a stored country code. Falls back to whatever is stored,
 * so a legacy row that holds a name, or a code this build has no name for, still
 * displays.
 */
export function countryName(code: string, countries: readonly ShippingCountry[]): string {
  return countries.find((c) => c.code === code)?.name ?? code;
}
