import { useCallback, useSyncExternalStore } from 'react';

export interface Route {
  section: string;
  tab: string | null;
  params: Record<string, string>;
}

const LAST_SECTION_KEY = 'bault.tab';

const LEGACY_ROUTES: Record<string, { section: string; tab: string }> = {
  services: { section: 'shipping-services', tab: 'requests' },
  shipping: { section: 'shipping-services', tab: 'shipping' },
};

const LEGACY_TABS: Record<string, Record<string, string>> = {
  wallet: {
    topup: 'cash-in',
    withdrawals: 'cash-out',
  },
  warehouse: {
    parcels: 'receiving',
    intake: 'receiving',
  },
};

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

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '');
  return parse(hash);
}

export function navigate(
  next: { section: string; tab?: string | null; params?: Record<string, string> },
  options: { replace?: boolean } = {},
): void {
  const target = build({ section: next.section, tab: next.tab ?? null, params: next.params ?? {} });
  if (window.location.hash === target) return;
  try {
    localStorage.setItem(LAST_SECTION_KEY, next.section);
  } catch {
  }
  if (options.replace) {
    window.history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

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
  }
}

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

  const setParams = useCallback(
    (next: Record<string, string | null | undefined>, options: { replace?: boolean } = {}) => {
      const params = { ...route.params };
      for (const [key, value] of Object.entries(next)) {
        if (value === '' || value === null || value === undefined) delete params[key];
        else params[key] = value;
      }
      navigate(
        { section: route.section, tab: route.tab, params },
        { replace: options.replace ?? true },
      );
    },
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

  return { goSection, goTab, openRecord, closeRecord, setParams };
}
