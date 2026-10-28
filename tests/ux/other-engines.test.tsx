import { describe, it, expect, vi, afterAll } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, webkit, type Browser, type BrowserType } from 'playwright-core';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { Field } = await import('../../apps/web/src/shared/ui/primitives');

/**
 * What the other engines did that Chromium did not. Firefox's and Safari's are run on the real stylesheets,
 * where they are installed (`playwright install firefox webkit`); a test skips for an engine that is not.
 * Chromium is here too, as the control: what the others do wrong is only worth reporting if it is not what
 * every browser does.
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

const engines: {
  name: string;
  type: BrowserType;
  options: Parameters<BrowserType['launch']>[0];
}[] = [
  { name: 'chromium', type: chromium, options: { executablePath: '/opt/pw-browsers/chromium' } },
  { name: 'firefox', type: firefox, options: {} },
  { name: 'webkit', type: webkit, options: {} },
];

const launched = new Map<string, Browser>();
for (const { name, type, options } of engines) {
  try {
    launched.set(name, await type.launch(options));
  } catch {
    // not installed here
  }
}

afterAll(async () => {
  for (const browser of launched.values()) await browser.close();
});

describe.each(engines.map((e) => e.name))('in %s', (name) => {
  const browser = launched.get(name);

  it.skipIf(!browser)(
    'a chosen option longer than the window does not widen the page (Safari let it run out of its select)',
    async () => {
      render(
        <main className="page">
          <Field label="Destination address">
            <select defaultValue="a">
              <option value="a">
                Home: Red Ashwood, 1200 Market St, San Francisco 94102, United States of America
              </option>
            </select>
          </Field>
        </main>,
      );
      const html = document.body.innerHTML;
      const page = await browser!.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        ...(name === 'firefox' ? {} : { isMobile: true }),
      });
      await page.setContent(
        `<!doctype html><html lang="en" dir="ltr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>` +
          `<body><div class="app-shell"><div class="workspace"><div class="workspace-inner">${html}</div></div></div></body></html>`,
      );
      const { scroll, inner } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(inner);
      await page.close();
    },
  );
});
