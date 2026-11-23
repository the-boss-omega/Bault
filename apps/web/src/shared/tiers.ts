import { useEffect, useState } from 'react';
import { api } from './api';

export type TierKey = 'bronze' | 'silver' | 'gold';

export const UNLIMITED = -1;

export interface TierRule {
  key: TierKey;
  minActions: number;
  minSpentMinor: number;
  discountBps: number;
}

export interface HonouredAllowances {
  tier: TierKey;
  honouredUntil: string;
  perCycle: Record<string, { allowed: number; used: number; remaining: number }>;
  storedItems: number;
  insuredShipments: { allowed: number; used: number; capMinor: number };
  postage: { creditMinor: number; usedMinor: number };
  commission: { waivedOnMinor: number; usedMinor: number };
  rushIncluded: boolean;
}

export interface TierStanding {
  tier: TierKey;
  discountBps: number;
  computedAt: string | null;
  window: { days: number; actions: number; spentMinor: number };
  next: {
    tier: TierKey;
    minActions: number;
    minSpentMinor: number;
    actionsToGo: number;
    spentToGoMinor: number;
  } | null;
  rules: TierRule[];
  honoured: HonouredAllowances | null;
}

export interface ViewerTier {
  tier: TierKey;
  discountBps: number;
}

export const LIST_PRICE: ViewerTier = { tier: 'bronze', discountBps: 0 };

export function discountedMinor(listMinor: number, discountBps: number): number {
  if (listMinor <= 0 || discountBps <= 0) return listMinor;
  return listMinor - Math.round((listMinor * discountBps) / 10_000);
}

export function percentOff(discountBps: number): string {
  return (discountBps / 100).toFixed(discountBps % 100 === 0 ? 0 : 2);
}

let cached: Promise<ViewerTier> | null = null;

export function loadViewerTier(): Promise<ViewerTier> {
  cached ??= api
    .get<TierStanding>('/tiers/me')
    .then((s) => (s && s.tier ? { tier: s.tier, discountBps: s.discountBps ?? 0 } : LIST_PRICE))
    .catch(() => {
      cached = null;
      return LIST_PRICE;
    });
  return cached;
}

export function forgetViewerTier(): void {
  cached = null;
}

export function useViewerTier(): ViewerTier {
  const [tier, setTier] = useState<ViewerTier>(LIST_PRICE);
  useEffect(() => {
    let live = true;
    void loadViewerTier().then((v) => {
      if (live) setTier(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return tier;
}
