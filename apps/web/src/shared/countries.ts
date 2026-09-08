import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * The destinations an address may name.
 *
 * Fetched rather than duplicated in the client. The list is derived on the
 * server from the carrier contracts themselves, and a second copy here would go
 * stale the first time one of them changed — which is precisely the failure this
 * replaced: the address form asked for a country as free text and pre-filled it
 * with the word "Israel", while every rule in `carriers.ts` reads that field as
 * an ISO 3166-1 alpha-2 code. Each address saved with the default was routed as
 * international and then refused by the one international service Israel is
 * actually contracted for, because `IL` is on the list and "Israel" is not.
 */
export interface ShippingCountry {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  name: string;
  /** The country the facilities are in — its rates are the cheap ones. */
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
 * The readable name for a stored country code.
 *
 * Addresses are stored as codes now, and a card that renders "1200 Market St,
 * San Francisco, US 94102" has swapped one unreadable value for another. Falls
 * back to whatever is stored, so a legacy row that still holds a name — or a
 * code this build has no name for — displays rather than disappearing.
 */
export function countryName(code: string, countries: readonly ShippingCountry[]): string {
  return countries.find((c) => c.code === code)?.name ?? code;
}
