import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bault.theme';

/** The page's own background, which the browser's chrome (the address bar on a phone) takes. */
const CHROME = { light: '#ffffff', dark: '#0a0a0a' } as const;

interface ThemeValue {
  choice: ThemeChoice;
  resolved: 'light' | 'dark';
  setChoice: (next: ThemeChoice) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function storedChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'dark';
  } catch {
    return 'dark';
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

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  // Before the paint, not after it: a page that is light must not be drawn dark first. (The first
  // time it is set by assets/theme-boot.js, from the head; this keeps it so when it changes.)
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[resolved]);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* storage can be blocked */
    }
  }, [choice, resolved]);

  // Printed, a page is ink on paper whichever theme it is read in: light values for the printing.
  useEffect(() => {
    let kept: string | null | undefined;
    const before = () => {
      const root = document.documentElement;
      kept = root.getAttribute('data-theme');
      root.setAttribute('data-theme', 'light');
    };
    const after = () => {
      if (kept === undefined) return;
      const root = document.documentElement;
      if (kept === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', kept);
      kept = undefined;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      after();
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => setChoiceState(next), []);
  const cycle = useCallback(
    () =>
      setChoiceState((cur) => (cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light')),
    [],
  );

  const value = useMemo<ThemeValue>(
    () => ({ choice, resolved, setChoice, cycle }),
    [choice, resolved, setChoice, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside a ThemeProvider');
  return ctx;
}
