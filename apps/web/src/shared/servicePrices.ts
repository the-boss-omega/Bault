import { useEffect, useState } from 'react';
import { api } from './api';
import { formatUsd } from './money';

export interface PriceEntry {
  actionType: string;
  description: string;
  model: 'fixed' | 'percentage';
  value: number;
  currency: string;
}

interface PriceList {
  groups: { group: string; entries: PriceEntry[] }[];
}

let cached: Promise<Map<string, PriceEntry>> | null = null;

function load(): Promise<Map<string, PriceEntry>> {
  cached ??= api
    .get<PriceList>('/pricing/list')
    .then((list) => {
      const byAction = new Map<string, PriceEntry>();
      for (const group of list.groups ?? []) {
        for (const entry of group.entries ?? []) byAction.set(entry.actionType, entry);
      }
      return byAction;
    })
    .catch(() => {
      cached = null;
      return new Map<string, PriceEntry>();
    });
  return cached;
}

export function useServicePrices(): Map<string, PriceEntry> {
  const [prices, setPrices] = useState<Map<string, PriceEntry>>(new Map());
  useEffect(() => {
    let live = true;
    void load().then((map) => {
      if (live) setPrices(map);
    });
    return () => {
      live = false;
    };
  }, []);
  return prices;
}

export function priceLabel(entry: PriceEntry | undefined): string | null {
  if (!entry) return null;
  if (entry.model === 'percentage') return `${(entry.value / 100).toFixed(entry.value % 100 === 0 ? 0 : 2)}%`;
  return entry.value === 0 ? null : formatUsd(entry.value);
}

export const SERVICE_FEE_ACTION: Record<string, string> = {
  photography: 'service',
  video: 'service_fee:video_review',
  inspection: 'service_fee:condition_inspection',
  deslab: 'service_fee:deslab',
  donation: 'service',
  buyout: 'service',
  consignment: 'service',
  'lot-split': 'service',
};
