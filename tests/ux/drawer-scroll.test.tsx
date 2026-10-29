import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { ReactNode } from 'react';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { DetailDrawer } = await import('../../apps/web/src/shared/ui/DetailDrawer');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
  auditFocus: (page: Page, stops?: number) => Promise<string[]>;
};

/**
 * A drawer whose body scrolls and has nothing in it to stop on (a request that has been settled, a closed case) is
 * a box that the keyboard cannot scroll: what is below its fold cannot be read without a pointer. The body is the
 * stop then, named for the drawer, for as long as it overflows and has no control of its own.
 */
const SRC = join(__dirname, '..', '..', 'apps', 'web', 'src');
const CSS = [
  'index',
  'theme',
  'slab',
  'components',
  'buttons',
  'landing',
  'app',
  'gallery',
  'screens',
  'motion',
]
  .map((name) => readFileSync(join(SRC, `${name}.css`), 'utf8'))
  .join('\n');
const BROWSER = '/opt/pw-browsers/chromium';

let browser: Browser | null = null;
try {
  browser = await chromium.launch(
    existsSync(BROWSER) ? { executablePath: BROWSER } : { channel: 'chrome' },
  );
} catch {
  browser = null;
}

afterAll(async () => {
  await browser?.close();
});

function Drawer({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <DetailDrawer title="Wallet request" onClose={() => {}}>
        {children}
      </DetailDrawer>
    </I18nProvider>
  );
}

const lines = Array.from({ length: 60 }, (_, i) => <p key={i}>Line number {i} of the request.</p>);
const body = () => document.querySelector<HTMLElement>('.drawer-body')!;

/** jsdom has no layout, so how tall a body is, and how much room it has, is whatever the test says. */
function size(el: HTMLElement, scrollHeight: number, clientHeight: number, scrollWidth = 400, clientWidth = 400) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
}

/** The check runs on the next frame. */
const frame = () => new Promise((resolve) => setTimeout(resolve, 10));

/** The window is resized, and the check is made. */
async function looked() {
  window.dispatchEvent(new Event('resize'));
  await frame();
}

describe('the body of a drawer that scrolls can be reached from the keyboard', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a stop, named for the drawer, while it overflows and has no control in it', async () => {
    render(<Drawer>{lines}</Drawer>);
    expect(body()).not.toHaveAttribute('tabindex');

    size(body(), 3000, 600);
    await looked();

    expect(body()).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('region', { name: 'Wallet request' })).toBe(body());
  });

  it('is a stop where it scrolls sideways too: what is past its edge cannot be read without a pointer either', async () => {
    render(<Drawer>{lines.slice(0, 2)}</Drawer>);
    size(body(), 120, 600, 398, 389);
    await looked();

    expect(body()).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('region', { name: 'Wallet request' })).toBe(body());
  });

  it('is left alone where there is a control in it: the control is the way to what is below', async () => {
    render(
      <Drawer>
        {lines}
        <button type="button">Approve</button>
      </Drawer>,
    );
    size(body(), 3000, 600);
    await looked();

    expect(body()).not.toHaveAttribute('tabindex');
    expect(body()).not.toHaveAttribute('role');
  });

  it('does not count a control that cannot be used as a way to anything', async () => {
    render(
      <Drawer>
        {lines}
        <button type="button" disabled>
          Approve
        </button>
      </Drawer>,
    );
    size(body(), 3000, 600);
    await looked();

    expect(body()).toHaveAttribute('tabindex', '0');
  });

  it('is left alone where it fits', async () => {
    render(<Drawer>{lines.slice(0, 2)}</Drawer>);
    size(body(), 120, 600);
    await looked();

    expect(body()).not.toHaveAttribute('tabindex');
  });

  it('gives the stop back when the room grows to hold what is in it', async () => {
    render(<Drawer>{lines}</Drawer>);
    size(body(), 3000, 600);
    await looked();
    expect(body()).toHaveAttribute('tabindex', '0');

    size(body(), 3000, 3200);
    await looked();

    expect(body()).not.toHaveAttribute('tabindex');
    expect(body()).not.toHaveAttribute('role');
    expect(body()).not.toHaveAttribute('aria-labelledby');
  });

  it('follows what is in it: a control that arrives takes the stop, and one that leaves gives it back', async () => {
    const { rerender } = render(<Drawer>{lines}</Drawer>);
    size(body(), 3000, 600);
    await looked();
    expect(body()).toHaveAttribute('tabindex', '0');

    // Nothing is resized: only what is in the body changes.
    rerender(
      <Drawer>
        {lines}
        <button type="button">Approve</button>
      </Drawer>,
    );
    await frame();
    expect(body()).not.toHaveAttribute('tabindex');

    rerender(<Drawer>{lines}</Drawer>);
    await frame();
    expect(body()).toHaveAttribute('tabindex', '0');
  });
});

describe.skipIf(!browser)('the body of a drawer that scrolls, in a browser', () => {
  async function inBrowser(width: number, locale: 'en' | 'he' = 'en'): Promise<Page> {
    const html = document.body.innerHTML;
    // axe wants a page that has its own context.
    const context = await browser!.newContext({
      viewport: { width, height: 800 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><html lang="${locale}" dir="${locale === 'he' ? 'rtl' : 'ltr'}" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>` +
        `<body>${html}</body></html>`,
    );
    return page;
  }

  /** The drawer as the app leaves it once its body has been measured: what jsdom made of it, drawn for real. */
  async function overflowing() {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0),
    );
    render(<Drawer>{lines}</Drawer>);
    size(body(), 3000, 600);
    await looked();
    vi.unstubAllGlobals();
  }

  for (const width of [390, 1440]) {
    it(`axe has nothing to say of it, and would have: ${width}px`, async () => {
      await overflowing();
      const page = await inBrowser(width);
      // The body really does scroll, with the real stylesheets: the test is not about a box that fits.
      expect(await page.$eval('.drawer-body', (el) => el.scrollHeight > el.clientHeight + 1)).toBe(
        true,
      );
      const rule = (flags: string[]) =>
        flags.filter((f) => f.includes('scrollable-region-focusable'));
      expect(rule(await audit.audit(page))).toEqual([]);

      // Without the stop, the same drawer is the one axe found on the phone: the rule is live here.
      await page.$eval('.drawer-body', (el) => {
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
        el.removeAttribute('aria-labelledby');
      });
      expect(rule(await audit.audit(page)).length).toBe(1);
      await page.context().close();
    });
  }

  it('shows its ring inside its edge, where the head and the foot do not cover it', async () => {
    await overflowing();
    const page = await inBrowser(390);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.className)).toContain('drawer-body');
    expect(await page.$eval('.drawer-body', (el) => getComputedStyle(el).outlineOffset)).toBe(
      '-2px',
    );
    expect(await page.$eval('.drawer-body', (el) => getComputedStyle(el).outlineStyle)).toBe(
      'solid',
    );
    // The audit's own check of a ring: there is one, it has the contrast, and nothing cuts it off.
    expect(await audit.auditFocus(page, 3)).toEqual([]);
    await page.context().close();
  });
});
