import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export interface AppNotification {
  id: string;
  eventType: string;
  content: unknown;
  channel: string;
  status: string;
  createdAt: string;
}

const SEEN_KEY = 'bault.notificationsSeenAt';

function readSeenAt(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function useNotificationFeed() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [seenAt, setSeenAt] = useState<string>(readSeenAt);

  const reload = useCallback(async () => {
    try {
      const list = await api.get<AppNotification[]>('/notifications');
      list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      setItems(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    try {
      localStorage.setItem(SEEN_KEY, now);
    } catch {
    }
    setSeenAt(now);
  }, []);

  const unseen = seenAt ? items.filter((n) => (n.createdAt ?? '') > seenAt).length : items.length;

  return { items, error, loading, reload, unseen, markSeen };
}
