import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bault.theme';

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
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  } catch {
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
