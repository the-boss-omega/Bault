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
