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

/**
 * A value that follows another once that has held still for `ms`: what is being typed, for what a request is
 * made of (a photograph is looked for by its name, and "SN-C", "SN-CL" and "SN-CL1" are not names).
 */
export function useDebounced<T>(value: T, ms = 400): T {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setHeld(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return held;
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

/** `enabled` is false for an account that is refused the feed (a suspended one): it is not asked for it. */
export function useNotificationFeed(enabled = true) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [seenAt, setSeenAt] = useState<string>(readSeenAt);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
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
  }, [enabled]);

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
