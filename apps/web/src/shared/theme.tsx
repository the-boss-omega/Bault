import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Light, dark, or whatever the machine says.
 *
 * Three states rather than two, and the third is the default — which is the
 * part products usually get wrong. "System" is not a fallback for having no
 * preference; it is a real preference, and it has to keep tracking the OS after
 * the page has loaded. Somebody whose laptop switches at sunset should watch
 * this switch with it, without touching anything.
 *
 * The choice stamps `data-theme` on the root element, which is what the two
 * palette blocks in `index.css` key off. `system` stamps NOTHING, so the
 * `prefers-color-scheme` media query is left to decide — that is why the dark
 * block there is guarded as `:root:not([data-theme='light'])` rather than
 * written as a plain media query.
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
    // A private window with storage blocked is not an error state; it is
    // somebody with no saved preference, which is exactly `system`.
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
