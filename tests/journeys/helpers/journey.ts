import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, onTestFailed } from 'vitest';
import type { Browser, Locator, Page } from 'playwright-core';
import { CURRENT_TERMS_VERSION } from '../../../apps/api/src/modules/acc/terms';
import { BASE, Client, SEED, SEED_PASSWORD, fixtureEmail, signIn } from '../../integration/helpers/http';
import { sql } from '../../integration/helpers/db';
import { launch, visitor } from './browser';
import { serveWeb, type WebApp } from './web';

export const WEB_PORT = Number(process.env.JOURNEY_WEB_PORT ?? 4180);
export const PASSWORD = 'journey password 1';

export interface Stack {
  browser: Browser;
  web: WebApp;
  close: () => Promise<void>;
}

export async function stack(apiBase = BASE, port = WEB_PORT): Promise<Stack> {
  const web = await serveWeb(new URL(apiBase).origin, port);
  const browser = await launch();
  return {
    browser,
    web,
    close: async () => {
      await browser.close();
      await web.close();
    },
  };
}

const FAILURES = process.env.JOURNEY_FAILURES ?? join(tmpdir(), 'journey-failures');

export async function openPage(s: Stack, name: string): Promise<Page> {
  const { page } = await visitor(s.browser, s.web.url);
  onTestFailed(async () => {
    try {
      mkdirSync(FAILURES, { recursive: true });
      const where = page.url();
      const tree = await page.locator('body').ariaSnapshot({ timeout: 5_000 });
      writeFileSync(join(FAILURES, `${name}.txt`), `${where}\n${tree}`);
      await page.screenshot({ path: join(FAILURES, `${name}.png`), fullPage: true, timeout: 5_000 });
    } catch {
    }
  });
  return page;
}

export async function signInAs(page: Page, login: string, password = SEED_PASSWORD): Promise<void> {
  await page.goto('/#/');
  const field = page.getByLabel('Email or username');
  if (!(await field.isVisible())) {
    await page.goto('/#/sign-in');
  }
  await field.fill(login);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await shows(page.getByRole('button', { name: 'My account' }));
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'My account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await shows(page.getByLabel('Email or username'));
}

export function uniqueUsername(label: string): string {
  return `${label}${randomBytes(4).toString('hex')}`;
}

export async function verificationLink(email: string): Promise<string> {
  const [row] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [email]);
  if (!row) throw new Error(`no account for ${email}`);
  const token = randomBytes(32).toString('hex');
  await sql(
    `INSERT INTO verification_token (user_id, type, token_hash, expires_at)
     VALUES ($1, 'email_verification', $2, now() + interval '1 day')`,
    [row.id, createHash('sha256').update(token).digest('hex')],
  );
  return `/#/verify-email?token=${token}`;
}

export interface Collector {
  email: string;
  username: string;
  id: string;
  client: Client;
}

export async function activeCollector(label: string, base = BASE): Promise<Collector> {
  const email = fixtureEmail(label);
  const username = uniqueUsername(label.slice(0, 8));
  const res = await new Client(base).post('/auth/register', {
    email,
    username,
    firstName: 'Journey',
    lastName: label.charAt(0).toUpperCase() + label.slice(1),
    password: PASSWORD,
    acceptedTermsVersion: CURRENT_TERMS_VERSION,
  });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  const token = (await verificationLink(email)).split('token=')[1]!;
  const verified = await new Client(base).post('/auth/verify-email', { token });
  if (verified.status !== 200) throw new Error(`verify failed: ${JSON.stringify(verified.body)}`);
  const client = await signIn(email, PASSWORD, base);
  const [row] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [email]);
  return { email, username, id: row!.id, client };
}

export async function fund(collector: Collector, amountMinor: number, base = BASE): Promise<string> {
  const created = await collector.client.post('/finance/wallet-requests', {
    type: 'cash_in',
    amountMinor,
    currency: 'USD',
    fundingSource: 'bank_transfer',
    reference: `journey-${Date.now()}-${randomBytes(3).toString('hex')}`,
  });
  if (created.status !== 201) throw new Error(`cash-in failed: ${JSON.stringify(created.body)}`);
  const admin = await signIn(SEED.admin, SEED_PASSWORD, base);
  for (const step of ['approve', 'complete']) {
    const res = await admin.post(`/admin/wallet-requests/${created.body.id}/${step}`, {});
    if (res.status !== 201) throw new Error(`${step} failed: ${JSON.stringify(res.body)}`);
  }
  return created.body.id as string;
}

export async function aShelf(): Promise<string> {
  const [row] = await sql<{ barcode: string }>(
    `SELECT b.barcode FROM bin b
       JOIN facility f ON f.id = b.facility_id
      WHERE b.active AND NOT b.oversized AND f.role = 'primary'
      ORDER BY b.barcode LIMIT 1`,
  );
  if (!row) throw new Error('no active standard shelf in the seeded data');
  return row.barcode;
}

const WAIT = { timeout: 15_000, interval: 100 };

export async function shows(locator: Locator): Promise<void> {
  await locator.first().waitFor({ state: 'visible' });
}

const squeeze = (text: string) => text.replace(/[\s⁦-⁩]+/g, '');

export async function says(locator: Locator, text: string | RegExp): Promise<void> {
  const read = async () => ((await locator.count()) > 0 ? ((await locator.first().textContent()) ?? '') : '');
  if (typeof text === 'string') await expect.poll(async () => squeeze(await read()), WAIT).toContain(squeeze(text));
  else await expect.poll(read, WAIT).toMatch(text);
}

export async function holds(locator: Locator, value: string): Promise<void> {
  await expect.poll(() => locator.inputValue(), WAIT).toBe(value);
}

export async function gone(locator: Locator): Promise<void> {
  await expect.poll(() => locator.count(), WAIT).toBe(0);
}

export async function pressAndSettle(page: Page, button: Locator, path: string): Promise<void> {
  const answered = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith(path) && r.request().method() === 'GET',
    { timeout: WAIT.timeout },
  );
  await button.click();
  await answered;
  await expect.poll(() => button.getAttribute('aria-busy'), WAIT).toBeNull();
}

export function panel(page: Page, title: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true, level: 2 }) });
}
