import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const BUNDLED = '/opt/pw-browsers/chromium';

export async function launch(): Promise<Browser> {
  return chromium.launch(existsSync(BUNDLED) ? { executablePath: BUNDLED } : { channel: 'chrome' });
}

export interface Visitor {
  context: BrowserContext;
  page: Page;
}

export async function visitor(browser: Browser, baseUrl: string): Promise<Visitor> {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  return { context, page };
}
