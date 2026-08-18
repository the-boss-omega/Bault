import { useCallback, useSyncExternalStore } from 'react';

/**
 * Minimal hash router — no dependency, no server-side rewrite requirement.
 *
 * Shape: `#/<section>/<tab>?<params>`, e.g.
 *   #/wallet
 *   #/wallet/transactions
 *   #/wallet/transactions?transaction=6f1b…
 *   #/warehouse/inventory
 *
 * The section drives the navigation rail, the tab drives the contextual tab
 * strip, and params carry the currently-open drawer record. Because opening a
 * drawer is a real history entry, the browser Back button closes the drawer
 * before it leaves the page (Requirement 37).
 */
export interface Route {
  section: string;
  tab: string | null;
  params: Record<string, string>;
}

/** Last visited section, so a refresh with no hash lands where the user left. */
const LAST_SECTION_KEY = 'bault.tab';

/**
 * Routes that no longer exist, and where they now live.
 *
 * Services stopped being a section of its own: card-specific services moved into
 * the Vault's card drawer and the operational ones merged with Shipping. Old
 * links, bookmarks and the persisted "last visited section" still say `services`
 * or `shipping`, so both are redirected rather than dropped on the floor. The
 * redirect keeps any tab the caller asked for only when the target section knows
 * it; otherwise it lands on the tab the old section was equivalent to.
 */
const LEGACY_ROUTES: Record<string, { section: string; tab: string }> = {
  services: { section: 'shipping-services', tab: 'requests' },
  shipping: { section: 'shipping-services', tab: 'shipping' },
};

/**
 * Retired TABS within a section that still exists.
 *
 * The wallet's `topup` and `withdrawals` tabs held forms that moved money
 * directly. Those forms are gone — cash in and cash out are reviewed requests —
 * but `#/wallet/topup` is a link people hold, so it lands on the tab that now
 * does that job rather than silently falling back to Overview.
 *
 * Keyed by section so a tab name retired in one section cannot accidentally
 * redirect a same-named tab in another.
 */
const LEGACY_TABS: Record<string, Record<string, string>> = {
  wallet: {
    topup: 'cash-in',
    withdrawals: 'cash-out',
  },
};

/**
 * Resolve a legacy route to its current home, or `null` if the route is already
 * current. Exported so the shell can redirect with `replace`, which keeps Back
 * from bouncing the user into the dead route again.
 *
 * A retired section wins over a retired tab: if the whole section moved, its old
 * tab names have no meaning in the new one.
 */
export function legacyRedirect(route: Route): { section: string; tab: string } | null {
  const section = LEGACY_ROUTES[route.section];
  if (section) return section;

  const tab = route.tab ? LEGACY_TABS[route.section]?.[route.tab] : undefined;
  if (tab) return { section: route.section, tab };

  return null;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = (pathPart ?? '').split('/').filter(Boolean).map(decodeURIComponent);
  const params: Record<string, string> = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart)) params[k] = v;
  }
  return {
    section: segments[0] ?? '',
    tab: segments[1] ?? null,
    params,
  };
}

function build(route: Partial<Route> & { section: string }): string {
  const path = [route.section, route.tab]
    .filter((segment): segment is string => Boolean(segment))
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const entries = Object.entries(route.params ?? {}).filter(([, v]) => v !== '' && v != null);
  const query = entries.length > 0 ? `?${new URLSearchParams(entries).toString()}` : '';
  return `#/${path}${query}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function snapshot(): string {
  return window.location.hash;
}

/** Current route, re-rendering the caller whenever the hash changes. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '');
  return parse(hash);
}

/**
 * Navigate. `replace` swaps the current history entry instead of pushing a new
 * one — used for redirects (role fallbacks, default tabs) so Back never lands
 * the user back on a route they were bounced off.
 */
export function navigate(
  next: { section: string; tab?: string | null; params?: Record<string, string> },
  options: { replace?: boolean } = {},
): void {
  const target = build({ section: next.section, tab: next.tab ?? null, params: next.params ?? {} });
  if (window.location.hash === target) return;
  try {
    localStorage.setItem(LAST_SECTION_KEY, next.section);
  } catch {
    /* private mode — routing still works, only the restore-on-refresh is lost */
  }
  if (options.replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

/** The section to open when the app boots with no hash. */
export function lastVisitedSection(): string | null {
  try {
    return localStorage.getItem(LAST_SECTION_KEY);
  } catch {
    return null;
  }
}

export function clearLastVisitedSection(): void {
  try {
    localStorage.removeItem(LAST_SECTION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Helpers bound to the current route: switch tab, or open/close a drawer, while
 * keeping everything else about the route (filters live in component state, the
 * selected record lives in the URL).
 */
export function useNavigation(route: Route) {
  const goSection = useCallback(
    (section: string, tab?: string | null) => navigate({ section, tab: tab ?? null }),
    [],
  );

  const goTab = useCallback(
    (tab: string) => navigate({ section: route.section, tab }),
    [route.section],
  );

  const openRecord = useCallback(
    (key: string, id: string) =>
      navigate({ section: route.section, tab: route.tab, params: { ...route.params, [key]: id } }),
    [route.section, route.tab, route.params],
  );

  const closeRecord = useCallback(
    (key: string) => {
      const params = { ...route.params };
      delete params[key];
      navigate({ section: route.section, tab: route.tab, params });
    },
    [route.section, route.tab, route.params],
  );

  return { goSection, goTab, openRecord, closeRecord };
}
