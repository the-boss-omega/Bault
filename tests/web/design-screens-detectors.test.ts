import { describe, it, expect, afterAll, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';

// The first page a browser gives is slow on a busy runner, and the files that use one run side by side, each with its own: five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * The audit (scripts/lib/audit-checks.mjs) looks at pages in a real browser. These are its detectors, shown
 * pages with a mistake planted in them and pages without: a reviewer's synthetic cases found that the first
 * edition of the Hebrew check missed wrapped text, English names with a year in front, negative amounts and
 * runs that are split across elements, and that nothing looked at a focus ring a box cut off.
 */
const BROWSER = '/opt/pw-browsers/chromium';

const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  inspect: (page: Page, locale: string, width: number) => Promise<{ flags: string[] }>;
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

async function hebrewPage(body: string, css = ''): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 900, height: 600 } });
  await page.setContent(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>${FONT} ${css}</style><body>${body}</body></html>`);
  return page;
}

const flagsOf = async (page: Page) => (await audit.inspect(page, 'he', 1440)).flags.filter((f) => /out of order|wrong way round|no island/.test(f));

describe.skipIf(!browser)('the audit sees what it exists to see', () => {
  afterAll(async () => {
    await browser?.close();
  });

  describe('an English phrase or a figure drawn out of order on a Hebrew page', () => {
    it('an English name with a year in front, which the bidirectional algorithm sends to the other end', async () => {
      const page = await hebrewPage('<p>הכרטיס 2011 Pokémon Call of Legends נמכר</p>');
      expect((await flagsOf(page)).join()).toMatch(/out of order.*2011 Pokémon/);
      await page.close();
    });

    it('the same name once it is wrapped over two lines', async () => {
      const page = await hebrewPage('<p id="p" style="width: 230px">הכרטיס 2011 Pokémon Call of Legends Rayquaza נמכר</p>');
      // It does wrap: it is taller than one line.
      expect(await page.$eval('#p', (el) => el.getBoundingClientRect().height)).toBeGreaterThan(30);
      expect((await flagsOf(page)).join()).toMatch(/out of order/);
      await page.close();
    });

    it('the same name with its words split across elements', async () => {
      const page = await hebrewPage('<p>הכרטיס <b>2011</b> <i>Pokémon Call</i> of Legends נמכר</p>');
      expect((await flagsOf(page)).join()).toMatch(/out of order/);
      await page.close();
    });

    it('an English sentence that ends the paragraph, whose full stop is drawn at its start', async () => {
      const page = await hebrewPage('<p>Password must be at least 8 characters.</p>');
      expect((await flagsOf(page)).join()).toMatch(/out of order.*Password/);
      await page.close();
    });

    it('a negative amount whose minus is drawn after the figure', async () => {
      const page = await hebrewPage('<p>השעיה אוטומטית מתחת ל -$20.00 לחשבון</p>');
      expect((await flagsOf(page)).join()).toMatch(/a sign after its figure/);
      await page.close();
    });

    it('lets through what is set in an island, a code, or the text that is its own language', async () => {
      const page = await hebrewPage(
        [
          '<p>הכרטיס <bdi dir="auto">2011 Pokémon Call of Legends</bdi> נמכר</p>',
          '<p>השעיה אוטומטית מתחת ל <span dir="ltr" style="unicode-bidi: isolate">-$20.00</span> לחשבון</p>',
          '<p>קוד <bdi dir="ltr">SN-CL10-0005</bdi> · 27 באוק׳ 2026</p>',
          '<p><bdi dir="auto">Password must be at least 8 characters.</bdi></p>',
          '<p style="unicode-bidi: plaintext">Password must be at least 8 characters.</p>',
          '<p dir="ltr">An English paragraph that is a left-to-right block, ending with a full stop.</p>',
          '<p>הכרטיס נמכר ב־27/10/2026 תמורת $1,200.00 בלבד.</p>',
          // A Hebrew sentence that ends in an English word ends at its left, and its full stop is the sentence's.
          '<p>הוסיפו את הכרטיס לכספת של Bault.</p>',
          // A name set into the string with isolate marks (what t() carries) is its own run.
          '<p>הכרטיס \u20682011 Pokémon Call of Legends\u2069 ← \u2068Raw\u2069 נמכר</p>',
          // Text for a screen reader is a pixel wide: where its characters sit means nothing.
          '<p style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">פתח את 2011 Pokémon Call of Legends</p>',
        ].join(''),
      );
      expect(await flagsOf(page)).toEqual([]);
      await page.close();
    });
  });

  describe('a cell that reads the page’s way with English text nothing isolates', () => {
    const table = (cell: string) => `<table><tr><td>${cell}</td></tr></table>`;
    const sentence = 'Second leg, charged only to parcels sent to a foreign address.';

    it('is flagged', async () => {
      const page = await hebrewPage(table(sentence), 'td { unicode-bidi: normal; }');
      expect((await flagsOf(page)).join()).toMatch(/English text in a Hebrew cell/);
      await page.close();
    });

    it('is not, once it is in an island or the cell takes its text’s direction', async () => {
      for (const [cell, css] of [
        [`<bdi dir="auto">${sentence}</bdi>`, 'td { unicode-bidi: normal; }'],
        [sentence, 'td { unicode-bidi: plaintext; }'],
        [`<span dir="ltr">${sentence}</span>`, 'td { unicode-bidi: normal; }'],
      ] as const) {
        const page = await hebrewPage(table(cell), css);
        expect(await flagsOf(page)).toEqual([]);
        await page.close();
      }
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
