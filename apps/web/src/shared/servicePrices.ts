import { useEffect, useState } from 'react';
import { api } from './api';
import { formatUsd } from './money';

/**
 * What a service costs, shown on the control that orders it.
 *
 * Every service on a card is billed the instant the request is created
 * (`ServiceRequestService.create`), so the price belongs next to the button.
 * The figures come from `GET /pricing/list`, the table the Help section renders.
 *
 * The list is fetched once and shared through a module-level promise, so
 * repeated drawer opens make one request. A card that opens before the prices
 * arrive shows its actions with the price omitted, never a placeholder that
 * could be mistaken for "free".
 */
export interface PriceEntry {
  actionType: string;
  description: string;
  model: 'fixed' | 'percentage';
  /** Cents for a fixed rule, basis points for a percentage one. */
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
      // A price that cannot be fetched is omitted. Clearing the cache lets the
      // next drawer try again.
      cached = null;
      return new Map<string, PriceEntry>();
    });
  return cached;
}

/** The price table keyed by action type, or an empty map until it arrives. */
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

/**
 * A rule rendered in the units it is actually stated in.
 *
 * A percentage rule stores basis points and a fixed one stores cents; running
 * both through `formatUsd` would turn 5% into "$5.00".
 */
export function priceLabel(entry: PriceEntry | undefined): string | null {
  if (!entry) return null;
  if (entry.model === 'percentage') return `${(entry.value / 100).toFixed(entry.value % 100 === 0 ? 0 : 2)}%`;
  return entry.value === 0 ? null : formatUsd(entry.value);
}

/**
 * The pricing rule each card service is billed under.
 *
 * Mirrors the `feeActionType` each service passes to `ServiceRequestService`;
 * anything that names no rule of its own falls back to the flat `service` rate,
 * as the server does. Grading is absent on purpose: its price depends on the
 * tier chosen inside its own form, which quotes it there.
 */
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
