import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export interface VaultItem {
  id: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  barcode: string;
}

/**
 * Loads the signed-in customer's vault items for an item picker, so forms send a
 * real item UUID rather than a typed barcode or name. `storedOnly` keeps only
 * items eligible for services, shipping and listing.
 */
export function useVaultItems(storedOnly = false) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await api.get<VaultItem[]>('/vault/items');
      setItems(storedOnly ? all.filter((i) => i.lifecycleState === 'stored') : all);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [storedOnly]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, error, reload };
}
