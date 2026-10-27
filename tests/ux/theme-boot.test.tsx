import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const BOOT = readFileSync(join(ROOT, 'assets', 'theme-boot.js'), 'utf8');
const INDEX = readFileSync(join(ROOT, 'apps', 'web', 'index.html'), 'utf8');

const { ThemeProvider, useTheme } = await import('../../apps/web/src/shared/theme');

function page() {
  const root = document.documentElement;
  root.setAttribute('lang', 'he');
  root.setAttribute('dir', 'rtl');
  root.setAttribute('data-theme', 'dark');
  document.head.querySelector('meta[name="theme-color"]')?.remove();
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', '#0a0a0a');
  document.head.appendChild(meta);
  return { root, meta };
}

function boot() {
  // The script is a classic one in the head: it runs in the page's own global scope.
  window.eval(BOOT);
}

function systemIs(scheme: 'dark' | 'light') {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-color-scheme') && query.includes(scheme),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  systemIs('light');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the page opens in the theme and language it was left in, before anything is drawn', () => {
  it('light and English: the attributes and the browser chrome are set by the head script', () => {
    const { root, meta } = page();
    localStorage.setItem('bault.theme', 'light');
    localStorage.setItem('bault.locale', 'en');

    boot();

    expect(root).toHaveAttribute('data-theme', 'light');
    expect(root).toHaveAttribute('lang', 'en');
    expect(root).toHaveAttribute('dir', 'ltr');
    expect(meta).toHaveAttribute('content', '#ffffff');
  });

  it('dark and Hebrew stay as the page says', () => {
    const { root, meta } = page();
    localStorage.setItem('bault.theme', 'dark');
    localStorage.setItem('bault.locale', 'he');

    boot();

    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(root).toHaveAttribute('dir', 'rtl');
    expect(meta).toHaveAttribute('content', '#0a0a0a');
  });

  it('the system choice leaves the theme to the system, and the chrome follows it', () => {
    const dark = page();
    localStorage.setItem('bault.theme', 'system');
    systemIs('dark');
    boot();
    expect(dark.root).not.toHaveAttribute('data-theme');
    expect(dark.meta).toHaveAttribute('content', '#0a0a0a');

    const light = page();
    systemIs('light');
    boot();
    expect(light.root).not.toHaveAttribute('data-theme');
    expect(light.meta).toHaveAttribute('content', '#ffffff');
  });

  it('with nothing stored the page keeps its own defaults, dark and Hebrew', () => {
    const { root, meta } = page();

    boot();

    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(root).toHaveAttribute('lang', 'he');
    expect(root).toHaveAttribute('dir', 'rtl');
    expect(meta).toHaveAttribute('content', '#0a0a0a');
  });

  it('with storage blocked it does not throw, and the defaults stand', () => {
    const { root } = page();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(boot).not.toThrow();
    expect(root).toHaveAttribute('data-theme', 'dark');
  });

  it('is a script of its own, first in the head, because the page allows no inline script', () => {
    const head = INDEX.slice(INDEX.indexOf('<head>'), INDEX.indexOf('</head>'));
    expect(head).toMatch(/<script src="\/theme-boot\.js"><\/script>/);
    // Nothing inline: every script tag names a file.
    for (const tag of head.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\bsrc=/);
    // It runs before the application's own script and before any stylesheet is asked for.
    expect(INDEX.indexOf('/theme-boot.js')).toBeLessThan(INDEX.indexOf('/src/main.tsx'));
    expect(head.indexOf('/theme-boot.js')).toBeLessThan(head.indexOf('rel="preload"'));
    // And the page's own defaults are the ones the script leaves alone.
    expect(INDEX).toMatch(/<html lang="he" data-theme="dark" dir="rtl">/);
  });
});

function Probe({ onTheme }: { onTheme: (t: ReturnType<typeof useTheme>) => void }) {
  onTheme(useTheme());
  return null;
}

describe('the theme provider keeps the page in step', () => {
  it('sets the theme and the browser chrome together, and again when the choice changes', () => {
    const { root, meta } = page();
    localStorage.setItem('bault.theme', 'light');
    let theme: ReturnType<typeof useTheme> | undefined;

    render(
      <ThemeProvider>
        <Probe onTheme={(t) => (theme = t)} />
      </ThemeProvider>,
    );

    expect(root).toHaveAttribute('data-theme', 'light');
    expect(meta).toHaveAttribute('content', '#ffffff');

    act(() => theme!.setChoice('dark'));
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(meta).toHaveAttribute('content', '#0a0a0a');
    expect(localStorage.getItem('bault.theme')).toBe('dark');
  });

  it('prints in the light values whatever it is read in, and puts the theme back after', () => {
    const { root } = page();
    localStorage.setItem('bault.theme', 'dark');

    render(
      <ThemeProvider>
        <Probe onTheme={() => {}} />
      </ThemeProvider>,
    );
    expect(root).toHaveAttribute('data-theme', 'dark');

    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(root).toHaveAttribute('data-theme', 'light');

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(root).toHaveAttribute('data-theme', 'dark');
  });

  it('puts the system choice back too: after printing there is still no theme attribute', () => {
    const { root } = page();
    localStorage.setItem('bault.theme', 'system');

    render(
      <ThemeProvider>
        <Probe onTheme={() => {}} />
      </ThemeProvider>,
    );
    expect(root).not.toHaveAttribute('data-theme');

    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(root).toHaveAttribute('data-theme', 'light');
    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(root).not.toHaveAttribute('data-theme');
  });
});
