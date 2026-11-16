import { describe, it, expect, afterAll, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';

// The first page a browser gives is slow on a busy runner, and the files that use one run side by side, each with its own: five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * The audit (scripts/lib/audit-checks.mjs) looks at pages in a real browser. These are its detectors, shown
 * pages with a mistake planted in them and pages without: a reviewer's synthetic cases found that nothing
 * looked at a focus ring a box cut off.
 */
const BROWSER = '/opt/pw-browsers/chromium';

const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  inspect: (page: Page, width: number) => Promise<{ flags: string[] }>;
  auditFocus: (page: Page, stops?: number) => Promise<string[]>;
  auditForced: (page: Page) => Promise<string[]>;
  auditTheme: (page: Page, expected: string) => Promise<string[]>;
};

let browser: Browser | null = null;
try {
  browser = await chromium.launch(existsSync(BROWSER) ? { executablePath: BROWSER } : { channel: 'chrome' });
} catch {
  browser = null;
}

const FONT = "body { font: 16px/1.4 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; margin: 16px; }";

async function englishPage(body: string, css = ''): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 900, height: 600 } });
  await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><style>${FONT} ${css}</style><body>${body}</body></html>`);
  return page;
}

describe.skipIf(!browser)('the audit sees what it exists to see', () => {
  afterAll(async () => {
    await browser?.close();
  });

  describe('an icon drawn larger than text', () => {
    const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"><path d="m9.5 6 6 6-6 6" /></svg>';
    const iconFlags = async (page: Page) => (await audit.inspect(page, 1440)).flags.filter((f) => /^an icon drawn larger/.test(f));

    it('a chevron that has been given no size, beside a link', async () => {
      const page = await englishPage(`<div style="width: 500px"><a href="#">Open ${CHEVRON}</a></div>`);
      expect((await iconFlags(page)).join()).toMatch(/an icon drawn larger than text: \d+x\d+ beside "Open"/);
      await page.close();
    });

    it('the same chevron at the size of a letter, and a large picture that is not an icon', async () => {
      const page = await englishPage(
        `<div style="width: 500px"><a href="#">Open ${CHEVRON.replace('<svg ', '<svg width="16" height="16" ')}</a>` +
          `<svg role="img" aria-label="a barcode" width="300" height="120" viewBox="0 0 10 4"><rect width="10" height="4" /></svg></div>`,
      );
      expect(await iconFlags(page)).toEqual([]);
      await page.close();
    });
  });

  describe('an id on screen', () => {
    const ID = '1e7a2e35-1fbd-4871-b4c9-17b5fc69d9ef';
    const idFlags = async (page: Page) => (await audit.inspect(page, 1440)).flags.filter((f) => /^id on screen/.test(f));

    it('an id that has got into a sentence', async () => {
      const page = await englishPage(`<p>Request ${ID} was approved</p>`);
      expect(await idFlags(page)).toEqual([`id on screen: ${ID}`]);
      await page.close();
    });

    it('an id that is a record\'s own number, alone in the face of a code beside its label, is what it is there to be', async () => {
      const page = await englishPage(`<dl><dt>Record id</dt><dd><code>${ID}</code></dd></dl>`);
      expect(await idFlags(page)).toEqual([]);
      await page.close();
    });

    it('but not one in a code that is part of a sentence', async () => {
      const page = await englishPage(`<p>Request <code>${ID} was approved</code></p>`);
      expect(await idFlags(page)).toEqual([`id on screen: ${ID}`]);
      await page.close();
    });
  });

  describe('a kicker that says its heading again', () => {
    it('is flagged, and is not when the line over the heading says something else', async () => {
      const page = await englishPage(
        '<form class="auth-card"><div class="auth-slip"><p class="auth-kicker">Two-step sign-in</p><h2>Two-step sign-in</h2></div></form>',
      );
      expect((await audit.inspect(page, 1440)).flags.join()).toMatch(/a kicker that says its heading again: "two-step sign-in"/);
      await page.close();
      const fine = await englishPage(
        '<form class="auth-card"><div class="auth-slip"><p class="auth-kicker">Second step</p><h2>Two-step sign-in</h2></div></form>',
      );
      expect((await audit.inspect(fine, 1440)).flags.filter((flag) => /kicker/.test(flag))).toEqual([]);
      await fine.close();
    });
  });

  describe('a focus ring the box it is in cuts off', () => {
    const strip = (padding: string) => `
      <div class="strip" style="overflow-x: auto; display: flex; gap: 16px; padding: ${padding}; width: 400px">
        <button style="flex: none">First</button><button style="flex: none">Second</button>
      </div>`;
    const css = 'button { outline: 2px solid #1a73e8; outline-offset: 2px; background: #fff; }';

    it('is flagged when the ring is drawn outside a box that scrolls', async () => {
      const page = await browser!.newPage({ viewport: { width: 900, height: 600 } });
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>${FONT} ${css}</style><body>${strip('0')}</body>`);
      expect((await audit.auditFocus(page, 4)).join()).toMatch(/the ring on button "First" is cut off by div\.strip, on its (left|top)/);
      await page.close();
    });

    it('is not when the box has room for it', async () => {
      const page = await browser!.newPage({ viewport: { width: 900, height: 600 } });
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>${FONT} ${css}</style><body>${strip('4px')}</body>`);
      expect((await audit.auditFocus(page, 4)).filter((f) => /cut off/.test(f))).toEqual([]);
      await page.close();
    });

    it('is not when the ring is drawn inside the element', async () => {
      const page = await browser!.newPage({ viewport: { width: 900, height: 600 } });
      await page.setContent(
        `<!doctype html><meta charset="utf-8"><style>${FONT} button { outline: 2px solid #1a73e8; outline-offset: -2px; background: #fff; }</style><body>${strip('0')}</body>`,
      );
      expect((await audit.auditFocus(page, 4)).filter((f) => /cut off/.test(f))).toEqual([]);
      await page.close();
    });
  });

  describe('a selected tab that forced colours leave unmarked', () => {
    const tabs = (bar: string) => `
      <style>
        .tabs { position: relative; display: flex; gap: 16px; }
        .tabs[data-ready='true']::after { content: ''; position: absolute; inset-inline-start: 0; inset-block-end: 0; width: 60px; height: 2px; background: ${bar}; }
      </style>
      <div class="tabs" role="tablist" data-ready="true"><button role="tab" aria-selected="true">One</button><button role="tab">Two</button></div>`;

    it('is flagged when its bar is a gradient the system takes away', async () => {
      const context = await browser!.newContext({ forcedColors: 'active' });
      const page = await context.newPage();
      await page.setContent(`<!doctype html><meta charset="utf-8"><body>${tabs('linear-gradient(90deg, red, blue)')}</body>`);
      expect((await audit.auditForced(page)).join()).toMatch(/the selected tab "One" is not marked/);
      await context.close();
    });

    it('is not when the bar is drawn in the system’s highlight', async () => {
      const context = await browser!.newContext({ forcedColors: 'active' });
      const page = await context.newPage();
      await page.setContent(`<!doctype html><meta charset="utf-8"><body>${tabs('Highlight')}</body>`);
      expect(await audit.auditForced(page)).toEqual([]);
      await context.close();
    });
  });

  describe('a page that is not in the theme it was asked for', () => {
    const darkPage = '<!doctype html><html data-theme="dark" style="color-scheme: dark"><meta charset="utf-8"><body>Page</body></html>';

    it('is flagged when the browser draws its controls in the other scheme', async () => {
      const page = await browser!.newPage();
      await page.setContent('<!doctype html><html data-theme="dark" style="color-scheme: light"><meta charset="utf-8"><body>Page</body></html>');
      expect((await audit.auditTheme(page, 'dark')).join()).toMatch(/draws its own controls in "light" on a dark page/);
      await page.close();
    });

    it('is not when it is, and is not under forced colours, which take the scheme away', async () => {
      const page = await browser!.newPage();
      await page.setContent(darkPage);
      expect(await audit.auditTheme(page, 'dark')).toEqual([]);
      await page.close();

      const context = await browser!.newContext({ forcedColors: 'active' });
      const forced = await context.newPage();
      await forced.setContent(darkPage);
      expect(await audit.auditTheme(forced, 'dark')).toEqual([]);
      await context.close();
    });
  });
});
