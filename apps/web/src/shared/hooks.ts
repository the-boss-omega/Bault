import { useCallback, useEffect, useState, type PointerEvent } from 'react';
import { api } from './api';

/** Reactive media query, used to switch the rail into its mobile drawer mode. */
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

/** True when the visitor asked their OS to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * The slab catches the light.
 *
 * A graded card in the hand is held up and turned, because that is how you read
 * the surface and how the foil answers. A vault that shows the same card as a
 * flat rectangle has taken that away, and the display case is the one screen
 * whose whole job is to give it back — so the tile leans towards the pointer and
 * a highlight tracks it across the sleeve.
 *
 * The maths stays in CSS: this only writes where the pointer is as custom
 * properties, which costs a style recalculation and no React render. It returns
 * NOTHING under `prefers-reduced-motion` and for a touch pointer — a finger is
 * on top of the card it would be tilting, so the effect is invisible and the
 * listener is pure cost.
 */
export function useCardTilt(): {
  onPointerMove?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
} {
  const reduced = usePrefersReducedMotion();

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return;
    const el = e.currentTarget;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    // Small angles on purpose. Anything past about 8° stops reading as a card
    // being turned and starts reading as a web page showing off.
    el.style.setProperty('--tilt-x', `${(0.5 - y) * 7}deg`);
    el.style.setProperty('--tilt-y', `${(x - 0.5) * 9}deg`);
    el.style.setProperty('--shine-x', `${x * 100}%`);
    el.style.setProperty('--shine-y', `${y * 100}%`);
    el.style.setProperty('--shine-o', '1');
  }, []);

  const onPointerLeave = useCallback((e: PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    // Back to flat through the same transition the lean came in on, rather than
    // snapping — the card settles.
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
    el.style.setProperty('--shine-o', '0');
  }, []);

  return reduced ? {} : { onPointerMove, onPointerLeave };
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

/**
 * The notification feed behind both the header bell and the notifications page.
 *
 * The API has no read/unread flag, so "new" is derived on the client from the
 * timestamp of the last time the user actually looked at the feed. That keeps the
 * badge meaningful without inventing a backend field.
 */
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
      /* ignore */
    }
    setSeenAt(now);
  }, []);

  const unseen = seenAt ? items.filter((n) => (n.createdAt ?? '') > seenAt).length : items.length;

  return { items, error, loading, reload, unseen, markSeen };
}

/**
 * How many of my tickets are waiting for ME.
 *
 * `awaiting_customer` means the helpdesk has answered and asked something back.
 * The route existed and nothing called it, so a question put to a collector sat
 * in a thread they had no reason to open again.
 */
export function useAwaitingReply(): number {
  const [awaiting, setAwaiting] = useState(0);

  useEffect(() => {
    let live = true;
    void api
      .get<{ awaiting: number }>('/support/awaiting')
      .then((res) => {
        if (live) setAwaiting(res.awaiting ?? 0);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return awaiting;
}
