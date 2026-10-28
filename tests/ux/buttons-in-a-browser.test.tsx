import { describe, it, expect, vi, afterAll } from 'vitest';
import { render } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

// The first page a browser gives is slow on a busy runner, and the files that use one run side by side, each with its own.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { Button, ButtonLink, IconButton } = await import('../../apps/web/src/shared/ui/primitives');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  auditButtons: (page: Page) => Promise<string[]>;
};

/**
 * The buttons as they are drawn, in a browser with the real stylesheets: how tall a control is under a pointer
 * and under a finger, that foil is on what can be pressed and on nothing else, that a button is read where
 * it stands (the page, the paper, the room) in both themes and both languages, and that a visitor whose
 * system paints the colours still sees which button is the one.
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

type Locale = 'en' | 'he';
interface Mode {
  width?: number;
  locale?: Locale;
  theme?: 'dark' | 'light';
  /** A fingertip, as a phone has: touch, and a coarse pointer. */
  touch?: boolean;
  forced?: boolean;
}

/** What jsdom has now, in a browser with the real stylesheets, as a visitor in this mode has it. */
async function inBrowser({
  width = 1100,
  locale = 'en',
  theme = 'dark',
  touch = false,
  forced = false,
}: Mode = {}): Promise<Page> {
  const html = document.body.innerHTML;
  const page = await browser!.newPage({
    viewport: { width, height: 900 },
    // Reduced motion, so that a state is its final one and not a frame of the way to it.
    reducedMotion: 'reduce',
    hasTouch: touch,
    isMobile: touch,
    forcedColors: forced ? 'active' : 'none',
  });
  await page.setContent(
    `<!doctype html><html lang="${locale}" dir="${locale === 'he' ? 'rtl' : 'ltr'}" data-theme="${theme}"><head><meta charset="utf-8"><style>${CSS}</style></head>` +
      `<body>${html}</body></html>`,
  );
  return page;
}

const glyph = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" fill="none" />
  </svg>
);

/** Every kind of button, as a row, to be put on each ground. */
const row = (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
    <Button variant="primary" icon={glyph}>
      Request cash in
    </Button>
    <Button>Request cash out</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="danger">Withdraw</Button>
    <Button variant="primary" size="sm">
      Reprice
    </Button>
    <Button size="sm">Reprice</Button>
    <Button pressed>Filter</Button>
    <ButtonLink variant="secondary" href="/ledger.csv" download icon={glyph}>
      Download
    </ButtonLink>
    <IconButton label="Notifications">{glyph}</IconButton>
    <IconButton label="Theme" bare>
      {glyph}
    </IconButton>
  </div>
);

const grounds = (
  <>
    <div id="page" style={{ padding: 16 }}>
      {row}
    </div>
    <div id="paper" className="on-paper drawer-tag" style={{ padding: 16 }}>
      {row}
    </div>
    <div
      id="room"
      className="on-room"
      style={{ padding: 16, background: 'var(--room)', color: 'var(--room-ink)' }}
    >
      {row}
    </div>
  </>
);

const height = (page: Page, selector: string) =>
  page.$eval(selector, (el) => el.getBoundingClientRect().height);

describe.skipIf(!browser)('the buttons, in a browser', () => {
  describe('the height of a control', () => {
    function controls() {
      return render(
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input id="field" type="text" aria-label="Search" />
          <Button id="md">Search</Button>
          <Button id="sm" size="sm">
            Search
          </Button>
          <IconButton id="icon" label="Search">
            {glyph}
          </IconButton>
        </div>,
      );
    }

    it('under a pointer, a field and a button are one height, so a button beside a field lines up with it', async () => {
      controls();
      const page = await inBrowser();
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(false);
      expect(await height(page, '#field')).toBe(40);
      expect(await height(page, '#md')).toBe(40);
      expect(await height(page, '#sm')).toBe(32);
      expect(await height(page, '#icon')).toBe(40);
      expect(await page.$eval('#icon', (el) => el.getBoundingClientRect().width)).toBe(40);
      await page.close();
    });

    it('under a finger, every one is 44px: a small button is small in what it says, not in what it asks of a thumb', async () => {
      controls();
      const page = await inBrowser({ width: 390, touch: true });
      // The emulation is the assumption; if it is not a coarse pointer the numbers below mean nothing.
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      for (const id of ['#field', '#md', '#sm', '#icon'])
        expect(await height(page, id), id).toBeGreaterThanOrEqual(44);
      expect(
        await page.$eval('#icon', (el) => el.getBoundingClientRect().width),
      ).toBeGreaterThanOrEqual(44);
      await page.close();
    });

    it('a link set in a sentence is the height of the sentence', async () => {
      render(
        <p style={{ fontSize: 14 }}>
          Do you have an account? <Button variant="link">Sign in</Button>
        </p>,
      );
      const page = await inBrowser({ width: 390, touch: true });
      expect(await height(page, 'button.btn--link')).toBeLessThan(30);
      await page.close();
    });
  });

  describe('foil', () => {
    it('is on a button that can be pressed and not on one that cannot, and not on a quiet one', async () => {
      render(
        <>
          <Button id="primary" variant="primary">
            Pay
          </Button>
          <Button id="working" variant="primary" loading>
            Pay
          </Button>
          <Button id="off" variant="primary" disabled>
            Pay
          </Button>
          <Button id="secondary">Pay</Button>
          <Button id="danger" variant="danger">
            Pay
          </Button>
        </>,
      );
      const page = await inBrowser();
      const image = (id: string) => page.$eval(id, (el) => getComputedStyle(el).backgroundImage);
      expect(await image('#primary')).toContain('linear-gradient');
      // A button that is working has not stopped being the button, and keeps its edge.
      expect(await image('#working')).toContain('linear-gradient');
      expect(await image('#off')).toBe('none');
      expect(await image('#secondary')).toBe('none');
      expect(await image('#danger')).toBe('none');
      await page.close();
    });

    it('a disabled button is a dashed outline, not a filled one: it is not a field either', async () => {
      render(
        <>
          <Button id="off" variant="primary" disabled>
            Pay
          </Button>
          <Button id="working" variant="primary" loading>
            Pay
          </Button>
        </>,
      );
      const page = await inBrowser();
      expect(await page.$eval('#off', (el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
      expect(await page.$eval('#off', (el) => getComputedStyle(el).backgroundColor)).toBe(
        'rgba(0, 0, 0, 0)',
      );
      expect(await page.$eval('#working', (el) => getComputedStyle(el).borderTopStyle)).toBe(
        'solid',
      );
      await page.close();
    });

    it('is reached for: a button that can be pressed grows its foil under a pointer, and one that cannot does not', async () => {
      render(
        <>
          <Button id="primary" variant="primary">
            Pay
          </Button>
          <Button id="off" variant="primary" disabled>
            Pay
          </Button>
        </>,
      );
      const page = await inBrowser();
      const strip = (id: string) =>
        page.$eval(id, (el) => getComputedStyle(el).backgroundSize.split(' ').pop());
      expect(await strip('#primary')).toBe('3px');
      await page.hover('#primary');
      expect(await strip('#primary')).toBe('5px');
      await page.hover('#off', { force: true });
      expect(await page.$eval('#off', (el) => getComputedStyle(el).backgroundImage)).toBe('none');
      await page.close();
    });
  });

  describe('where a button stands', () => {
    // The primary is the paper in the dark theme (cream on the room's black), the paper's ink in the light (ink on the page's white),
    // and on the paper itself the ink in both: the one that is not the colour of what it stands on.
    const PAPER = 'rgb(243, 239, 230)';
    const INK = 'rgb(21, 19, 15)';
    for (const [theme, page_, paper, room] of [
      ['dark', PAPER, INK, PAPER],
      ['light', INK, INK, PAPER],
    ] as const) {
      it(`its primary is the colour that is not the colour of the ground, in the ${theme} theme`, async () => {
        render(grounds);
        const page = await inBrowser({ theme });
        const face = (ground: string) =>
          page.$eval(`${ground} .btn--primary`, (el) => getComputedStyle(el).backgroundColor);
        expect(await face('#page')).toBe(page_);
        expect(await face('#paper')).toBe(paper);
        expect(await face('#room')).toBe(room);
        await page.close();
      });
    }

    for (const theme of ['dark', 'light'] as const) {
      for (const locale of ['en', 'he'] as const) {
        it(`every button is read, edged and large enough on the page, on paper and in the room: ${theme}, ${locale}`, async () => {
          render(grounds);
          const page = await inBrowser({ theme, locale });
          expect(await audit.auditButtons(page)).toEqual([]);
          await page.close();
        });
      }
    }

    it('and under a finger, the audit asks for 44px of every one', async () => {
      render(grounds);
      const page = await inBrowser({ width: 390, touch: true });
      expect(await audit.auditButtons(page)).toEqual([]);
      await page.close();
    });

    it('the audit is not blind: a button that sits on its own colour is found', async () => {
      render(
        <div id="page" style={{ padding: 16 }}>
          <Button variant="primary">Pay</Button>
        </div>,
      );
      const page = await inBrowser({ theme: 'dark' });
      // A paper button on a paper ground, with its ink and its line lost: nothing to see where it ends.
      await page.addStyleTag({
        content:
          '#page { background: var(--paper); } .btn--primary { background-color: var(--paper); border-color: var(--paper); }',
      });
      const flags = await audit.auditButtons(page);
      expect(flags.some((flag) => /edge/.test(flag))).toBe(true);
      await page.close();
    });
  });

  describe('a visitor whose system paints the colours', () => {
    it('still sees which button is the one: its foot is a heavy line, and a switch that is on is a highlight', async () => {
      render(
        <>
          <Button id="primary" variant="primary">
            Pay
          </Button>
          <Button id="secondary">Pay</Button>
          <Button id="on" pressed>
            Pay
          </Button>
          <Button id="ghost" variant="ghost">
            Pay
          </Button>
        </>,
      );
      const page = await inBrowser({ forced: true });
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
      const edge = (id: string) => page.$eval(id, (el) => getComputedStyle(el).borderBottomWidth);
      expect(await edge('#primary')).toBe('4px');
      expect(await edge('#secondary')).toBe('1px');
      expect(await edge('#on')).toBe('4px');
      // The quiet one still has an outline to find it by, of a kind the others do not have.
      expect(await page.$eval('#ghost', (el) => getComputedStyle(el).borderTopStyle)).toBe(
        'dotted',
      );
      expect(await page.$eval('#primary', (el) => getComputedStyle(el).borderTopStyle)).toBe(
        'solid',
      );
      await page.close();
    });
  });

  describe('in Hebrew', () => {
    it('the glyph is at the start of the line, which is the right, and the label follows it to the left', async () => {
      render(
        <Button id="b" icon={<svg id="g" width="16" height="16" aria-hidden="true" />}>
          בקשת הפקדה
        </Button>,
      );
      const page = await inBrowser({ locale: 'he' });
      const glyphBox = await page.$eval('#g', (el) => el.getBoundingClientRect().toJSON());
      const labelBox = await page.$eval('#b .btn-label', (el) =>
        el.getBoundingClientRect().toJSON(),
      );
      expect(glyphBox.left).toBeGreaterThanOrEqual(labelBox.right - 1);
      await page.close();
    });

    it('a button as wide as its container wraps a long label rather than running out of it', async () => {
      render(
        <div id="box" style={{ width: 240 }}>
          <Button id="b" block variant="primary">
            שליחת בקשת הפקדה ואישור התנאים של הוואלט
          </Button>
        </div>,
      );
      const page = await inBrowser({ locale: 'he', width: 320 });
      const { scroll, client } = await page.$eval('#b', (el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client + 1);
      expect(await height(page, '#b')).toBeGreaterThan(40);
      await page.close();
    });
  });
});
