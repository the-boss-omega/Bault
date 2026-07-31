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
 * Loads the signed-in customer's vault items so the UI can offer a PICKER instead
 * of a free-text id field. Passing a real item UUID (not a typed barcode/name) is
 * what prevents the "invalid input syntax for type uuid" 500s on services/shipping.
 * `storedOnly` filters to items that are eligible for services/shipping/listing.
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
