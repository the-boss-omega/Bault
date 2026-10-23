import { useEffect, useState } from 'react';
import { api } from './api';

export interface ShippingRegion {
  code: string;
  name: string;
}

export interface ShippingCountry {
  code: string;
  name: string;
  domestic: boolean;
  regionRequired: boolean;
  regions?: ShippingRegion[];
}

let cached: Promise<ShippingCountry[]> | null = null;

export function useShippingCountries(): ShippingCountry[] {
  const [rows, setRows] = useState<ShippingCountry[]>([]);
  useEffect(() => {
    let live = true;
    cached ??= api.get<ShippingCountry[]>('/shipping/countries').catch(() => {
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

export function countryName(code: string, countries: readonly ShippingCountry[]): string {
  return countries.find((c) => c.code === code)?.name ?? code;
}

export function regionRequired(code: string, countries: readonly ShippingCountry[]): boolean {
  return countries.find((c) => c.code === code.toUpperCase())?.regionRequired ?? false;
}

export function lacksRegion(
  address: { country: string; region?: string | null },
  countries: readonly ShippingCountry[],
): boolean {
  return !address.region && regionRequired(address.country, countries);
}
