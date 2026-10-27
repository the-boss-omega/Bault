import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

/**
 * What a visitor sees before the application has started: the page as the server sends it, its stylesheet,
 * and the one script that is allowed to run first. The bundle is held back, so what is measured is the first
 * frame and not the second. A visitor who left in the light theme and in English must not be shown a dark
 * Hebrew page that then changes, and the browser's own controls and chrome must be in the theme from the start.
 *
 * It needs the production build (pnpm --filter @bault/web build), which is what is served, and a browser.
 */
const DIST = join(__dirname, '..', '..', 'apps', 'web', 'dist');
const BROWSER = '/opt/pw-browsers/chromium';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

let server: Server | null = null;
let origin = '';
let browser: Browser | null = null;

if (existsSync(join(DIST, 'index.html'))) {
  try {
    browser = await chromium.launch(existsSync(BROWSER) ? { executablePath: BROWSER } : { channel: 'chrome' });
    server = createServer((req, res) => {
      const path = join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0]));
      const file = path.startsWith(DIST) && existsSync(path) && statSync(path).isFile() ? path : join(DIST, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  } catch {
    browser = null;
  }
}

afterAll(async () => {
  await browser?.close();
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
});

interface First {
  theme: string | null;
  lang: string;
  dir: string;
  scheme: string;
  chrome: string | null;
  bright: number;
}

/** The first frame: the page loaded with its application held back, under these stored choices and this system theme. */
async function firstFrame(stored: Record<string, string>, system: 'light' | 'dark'): Promise<First> {
  const context = await browser!.newContext({ colorScheme: system, viewport: { width: 1280, height: 800 } });
  const page: Page = await context.newPage();
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, stored);
  // Nothing runs but the head's own script: the application's bundle is not allowed to start.
  await page.route('**/*.js', (route) => (route.request().url().endsWith('/theme-boot.js') ? route.continue() : route.abort()));
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  const frame = await page.evaluate(() => {
    const root = document.documentElement;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return {
      theme: root.getAttribute('data-theme'),
      lang: root.getAttribute('lang') ?? '',
      dir: root.getAttribute('dir') ?? '',
      scheme: getComputedStyle(root).colorScheme,
      chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
      bright: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
    };
  });
  await context.close();
  return frame;
}

describe.skipIf(!browser)('the first frame, before the application starts', () => {
  it('light and English, on a dark system: a light English page, and the browser draws its own controls light', async () => {
    const frame = await firstFrame({ 'bault.theme': 'light', 'bault.locale': 'en' }, 'dark');
    expect(frame).toMatchObject({ theme: 'light', lang: 'en', dir: 'ltr', scheme: 'light', chrome: '#ffffff' });
    expect(frame.bright).toBeGreaterThan(0.9);
  });

  it('dark and Hebrew, on a light system: a dark right-to-left page, controls dark', async () => {
    const frame = await firstFrame({ 'bault.theme': 'dark', 'bault.locale': 'he' }, 'light');
    expect(frame).toMatchObject({ theme: 'dark', lang: 'he', dir: 'rtl', scheme: 'dark', chrome: '#0a0a0a' });
    expect(frame.bright).toBeLessThan(0.1);
  });

  it('the system’s choice follows the system, in the page, in the controls and in the browser’s chrome', async () => {
    const light = await firstFrame({ 'bault.theme': 'system' }, 'light');
    expect(light).toMatchObject({ theme: null, scheme: 'light', chrome: '#ffffff' });
    expect(light.bright).toBeGreaterThan(0.9);

    const dark = await firstFrame({ 'bault.theme': 'system' }, 'dark');
    expect(dark).toMatchObject({ theme: null, scheme: 'dark', chrome: '#0a0a0a' });
    expect(dark.bright).toBeLessThan(0.1);
  });

  it('nobody has chosen anything: the product’s own defaults, dark and Hebrew, whatever the system', async () => {
    for (const system of ['light', 'dark'] as const) {
      const frame = await firstFrame({}, system);
      expect(frame).toMatchObject({ theme: 'dark', lang: 'he', dir: 'rtl', scheme: 'dark' });
      expect(frame.bright).toBeLessThan(0.1);
    }
  });
});
