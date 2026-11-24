import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';

interface PriceListEntry {
  actionType: string;
  itemClass?: string | null;
  description: string;
}

interface PriceList {
  groups: { group: string; entries: PriceListEntry[] }[];
}

export interface ChargeNames {
  get(action: string, itemClass: string | null | undefined): string | null;
}

const NONE: ChargeNames = { get: () => null };

function keyOf(action: string, itemClass: string | null | undefined): string {
  return `${action}|${itemClass ?? ''}`;
}

export function chargeNamesFrom(list: PriceList): ChargeNames {
  const exact = new Map<string, string>();
  const byAction = new Map<string, string[]>();
  for (const group of list.groups ?? []) {
    for (const entry of group.entries ?? []) {
      exact.set(keyOf(entry.actionType, entry.itemClass), entry.description);
      byAction.set(entry.actionType, [
        ...(byAction.get(entry.actionType) ?? []),
        entry.description,
      ]);
    }
  }
  return {
    get(action, itemClass) {
      const found = exact.get(keyOf(action, itemClass)) ?? exact.get(keyOf(action, null));
      if (found) return found;
      const all = byAction.get(action) ?? [];
      return all.length === 1 ? all[0]! : null;
    },
  };
}

export function useChargeNames(): ChargeNames {
  const [names, setNames] = useState<ChargeNames>(NONE);
  useEffect(() => {
    let live = true;
    api
      .get<PriceList>('/pricing/list')
      .then((list) => {
        if (live && list) setNames(chargeNamesFrom(list));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return names;
}
