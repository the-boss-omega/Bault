import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Light, dark, or whatever the machine says.
 *
 * "System" is the default and a real preference: it keeps tracking the OS after
 * the page has loaded, so a laptop that switches at sunset switches the app too.
 *
 * The choice stamps `data-theme` on the root element, which the two palette
 * blocks in `index.css` key off. `system` stamps nothing and leaves it to the
 * `prefers-color-scheme` media query, which is why the dark block there is
 * guarded as `:root:not([data-theme='light'])`.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bault.theme';

interface ThemeValue {
  /** What the person chose. */
  choice: ThemeChoice;
  /** What is actually on screen right now, after resolving `system`. */
  resolved: 'light' | 'dark';
  setChoice: (next: ThemeChoice) => void;
  /** Cycles light → dark → system, which is what a single control should do. */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function storedChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  } catch {
    // Storage blocked (a private window) means no saved preference: `system`.
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(storedChoice);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Keep following the OS while the tab is open, not only at boot.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* nothing to do; the choice still applies for this session */
    }
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => setChoiceState(next), []);
  const cycle = useCallback(
    () =>
      setChoiceState((cur) => (cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light')),
    [],
  );

  const value = useMemo<ThemeValue>(
    () => ({
      choice,
      resolved: choice === 'system' ? (systemDark ? 'dark' : 'light') : choice,
      setChoice,
      cycle,
    }),
    [choice, systemDark, setChoice, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside a ThemeProvider');
  return ctx;
}
