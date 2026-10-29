import { describe, it, expect, vi, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { StorefrontPanel } =
  await import('../../apps/web/src/areas/customer/marketplace/StorefrontPanel');

/**
 * The link to a collector's storefront, in a sentence that reads the other way: "#/marketplace/store?seller=red" is
 * an address, read left to right from its first character. Set into a Hebrew sentence as it was, its leading "#/" and
 * its "?" took the line's direction and the address was drawn in pieces ("marketplace/store?/#" ).
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

describe.skipIf(!browser)('the link to a storefront, in a sentence', () => {
  it('is an island that reads left to right in Hebrew: its first character is its leftmost', async () => {
    localStorage.setItem('bault.locale', 'he');
    render(
      <I18nProvider>
        <StorefrontPanel myUsername="red" onError={() => {}} />
      </I18nProvider>,
    );
    const note = (await screen.findByText(/marketplace\/store\?seller=red/)).closest(
      '.success-note, .note, div',
    )!;
    // The address is set apart from the sentence by isolate marks, which are not read and not drawn.
    expect(note.textContent).toContain('⁦#/marketplace/store?seller=red⁩');

    const context = await browser!.newContext({
      viewport: { width: 1000, height: 600 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><html lang="he" dir="rtl" data-theme="dark"><head><meta charset="utf-8"><title>x</title><style>${CSS}</style></head><body>${document.body.innerHTML}</body></html>`,
    );
    // Where its first and its last character are drawn, left to right.
    const [first, last] = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        const at = text.indexOf('#/marketplace');
        if (at < 0) continue;
        const end = text.indexOf('seller=red') + 'seller=red'.length - 1;
        const x = (offset: number) => {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          return range.getBoundingClientRect().left;
        };
        return [x(at), x(end)];
      }
      return [NaN, NaN];
    });
    expect(first).toBeLessThan(last!);
    await context.close();
  });
});
