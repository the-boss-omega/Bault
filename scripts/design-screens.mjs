#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import {
  audit,
  auditButtons,
  auditFocus,
  auditForced,
  auditTheme,
  inspect,
} from './lib/audit-checks.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Captures every screen of a local, seeded Bault for a design review.

  pnpm design:screens [options]

Before it runs: a seeded database (pnpm db:reset), the API (pnpm dev:api) and a
production build of the web app (pnpm --filter @bault/web build). The script serves
that build itself with vite preview on port 4173, the one port the API accepts
writes from in development, and points it at --api.

It enrols two-factor on the seeded staff accounts the first time and keeps their
secrets in <out>/.totp.json, so it refuses any address that is not this machine.
Start the API with MFA_REQUIRED_ROLES=admin,warehouse_operator, as production
has it, so the staff enrolment screens are the ones production shows.

Options:
  --api <url>        API the preview proxies to (default http://127.0.0.1:3000)
  --base-url <url>   use a web app already running there instead of starting one
  --out <dir>        where the images and index.html go (default design-screens)
  --personas <list>  anonymous,collector,seller,suspended,operator,admin (default all)
  --locales <list>   he,en (default both)
  --widths <list>    390,1440 (default both)
  --theme <name>     dark or light (default dark, the product's default). The choice is
                     stored the way the app's own switch stores it, so this is the
                     theme the pages render, not only the browser's preference
  --axe              also run axe-core's WCAG 2.x A and AA rules (contrast, names,
                     labels, ARIA) on every screen, and walk the keyboard focus order
                     of every screen, in both languages and at both widths, to measure
                     every focus ring against what is behind it and to see whether
                     the box it sits in cuts it off (axe does not check focus
                     indicators); what it finds is listed as flags
  --focus-stops <n>  how many stops the focus walk takes on each screen (default 40)
  --motion           run with motion as a visitor who has not asked for less sees it.
                     Without it every page is captured with reduced motion, so that
                     nothing is mid-fade; the overlays are opened with motion either way
  --forced           capture with forced colours on too, and check that the current
                     page, the selected tab and the selected row are still drawn
  --no-overlays      skip opening the header's menus, a drawer, the photograph and a
                     confirmation, and measuring that each one is on screen, covers
                     what it should and can be reached
  --only <text>      capture only screens whose name contains this text
  --engine <name>    chromium, firefox or webkit (default chromium): the engines of Chrome,
                     of Firefox and of Safari. The other two have to be installed first
                     (playwright install firefox webkit). Firefox has no mobile viewport, so
                     at phone width it is a narrow window with touch, not a phone
  --browser <path>   Chromium or Chrome to drive with --engine chromium (default
                     /opt/pw-browsers/chromium when it exists, otherwise the installed
                     Google Chrome)
  --password <pw>    the seeded accounts' password (default 11111111)

The first record each screen opens (a guide, a question, a ticket, a parcel, a shipment, a
transaction, a request) is opened and captured as a screen of its own, named <screen>-record
(--only record asks for those alone), and the run says which kinds of record it did not reach.

Open <out>/index.html when it finishes. Screens with automatic flags (an id,
cents, an enum name or English words on a Hebrew page, an English phrase, a date,
a price or a figure drawn out of order on a Hebrew page, English text in a Hebrew
cell that nothing isolates, a page that is not in the theme it was asked for, sideways
scrolling or content cut off at the edge at phone width, a menu, a drawer or the
photograph that is off screen, does not cover what it should or cannot be clicked,
a console error, a failed API call or, with --axe, an accessibility violation or a
focus ring that is absent, faint or cut off) are listed first. The emails are looked
at the same way, as the two-language messages they are.`;

const PERSONAS = {
  anonymous: { login: null },
  collector: { login: 'red' },
  seller: { login: 'golden', sections: ['marketplace', 'wallet'] },
  suspended: { login: 'dana' },
  operator: { login: 'hermon', staff: true },
  admin: { login: 'eldar', staff: true },
};

const SECTIONS = [
  'vault',
  'inbound',
  'wallet',
  'membership',
  'marketplace',
  'shipping-services',
  'warehouse',
  'notifications',
  'support',
  'faq',
  'admin',
  'profile',
];

const ANONYMOUS_ROUTES = [
  ['landing', '#/'],
  ['signin', '#/signin'],
  ['signup', '#/signup'],
  ['forgot', '#/forgot'],
  ['verify-email-invalid', '#/verify-email?token=invalid', [400, 410]],
  ['reset-password-invalid', '#/reset-password?token=invalid', [400, 410]],
];

const VAULT_SCOPES = ['active', 'hold', 'history'];

/**
 * What a screen opens. A list is one page and the record it opens is another: a guide opens its steps, a question
 * its answer, and a ticket, a parcel, a shipment, a transaction or a request its record, each named in the
 * address (`?g=`, `?ticket=`). A capture of a list says nothing about what it opens: the steps of a guide were
 * drawn with every full stop at the wrong end of its line for as long as the audit did not open one.
 */
const RECORD_OPENERS = ['tr.is-clickable', 'li.label-card', '.register-link', '.faq-trigger', '.card-hit'];

/**
 * Every kind of record the app opens, and the audit opens each one: by the first row, label, card or question a
 * screen has, or (an account, an item, a ticket in the operator's queue) by its address. A kind the app gains is a
 * screen the audit does not see until it is added here and there is a way to reach it; a test reads the app's
 * source for the kinds it opens and fails until this list says the same.
 */
export const RECORD_KINDS = ['g', 'item', 'parcel', 'q', 'request', 'shipment', 'ticket', 'transaction', 'user'];

/** The kinds of record a source opens, read from where it opens them: `openRecord('ticket', id)`. */
export function recordKindsOf(source) {
  return [...new Set([...source.matchAll(/openRecord\(\s*'([a-z]+)'/g)].map((m) => m[1]))].sort();
}

export function recordKindsOfTheApp() {
  const root = join(repoRoot, 'apps/web/src');
  const kinds = new Set();
  for (const file of readdirSync(root, { recursive: true })) {
    if (typeof file !== 'string' || !/\.tsx?$/.test(file)) continue;
    for (const kind of recordKindsOf(readFileSync(join(root, file), 'utf8'))) kinds.add(kind);
  }
  return [...kinds].sort();
}

function parseArgs(argv) {
  const out = {
    api: 'http://127.0.0.1:3000',
    baseUrl: null,
    out: 'design-screens',
    personas: Object.keys(PERSONAS),
    locales: ['he', 'en'],
    widths: [390, 1440],
    theme: 'dark',
    axe: false,
    focusStops: 40,
    motion: false,
    forced: false,
    overlays: true,
    only: null,
    engine: 'chromium',
    browser: null,
    password: '11111111',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    const list = () => value().split(',').map((s) => s.trim()).filter(Boolean);
    if (flag === '--help' || flag === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (flag === '--api') out.api = value();
    else if (flag === '--base-url') out.baseUrl = value();
    else if (flag === '--out') out.out = value();
    else if (flag === '--personas') out.personas = list();
    else if (flag === '--locales') out.locales = list();
    else if (flag === '--widths') out.widths = list().map(Number);
    else if (flag === '--theme') out.theme = value();
    else if (flag === '--axe') out.axe = true;
    else if (flag === '--focus-stops') out.focusStops = Number(value());
    else if (flag === '--motion') out.motion = true;
    else if (flag === '--forced') out.forced = true;
    else if (flag === '--no-overlays') out.overlays = false;
    else if (flag === '--only') out.only = value();
    else if (flag === '--engine') out.engine = value();
    else if (flag === '--browser') out.browser = value();
    else if (flag === '--password') out.password = value();
    else throw new Error(`Unknown option ${flag}. Run with --help.`);
  }
  for (const p of out.personas) {
    if (!PERSONAS[p]) throw new Error(`Unknown persona "${p}". Known: ${Object.keys(PERSONAS).join(', ')}`);
  }
  for (const l of out.locales) {
    if (l !== 'he' && l !== 'en') throw new Error(`Unknown locale "${l}"`);
  }
  if (out.widths.some((w) => !Number.isInteger(w) || w < 320)) throw new Error('--widths takes whole pixel widths');
  if (out.theme !== 'light' && out.theme !== 'dark') throw new Error('--theme is light or dark');
  if (!ENGINES[out.engine])
    throw new Error(`Unknown engine "${out.engine}". Known: ${Object.keys(ENGINES).join(', ')}`);
  return out;
}

function assertLocal(url) {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      `${url} is not this machine. This script signs in with the seed's published password and enrols ` +
        'two-factor on staff accounts, so it only runs against a local, seeded database.',
    );
  }
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of input.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secretBase32, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

const lastStep = new Map();

async function freshCode(login, secret) {
  let step = Math.floor(Date.now() / 30000);
  if ((lastStep.get(login) ?? -1) >= step) {
    await new Promise((r) => setTimeout(r, (step + 1) * 30000 - Date.now() + 200));
    step = Math.floor(Date.now() / 30000);
  }
  lastStep.set(login, step);
  return totp(secret, step);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Nothing answered at ${url}`);
}

async function startPreview(api) {
  if (!existsSync(join(repoRoot, 'apps/web/dist/index.html'))) {
    throw new Error('No production build of the web app. Run `pnpm --filter @bault/web build` first.');
  }
  await waitForHttp(`${api.replace(/\/+$/, '')}/api/v1/readyz`, 5000).catch(() => {
    throw new Error(`The API is not answering at ${api}. Start it with \`pnpm dev:api\`.`);
  });
  const child = spawn('pnpm', ['--filter', '@bault/web', 'exec', 'vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: repoRoot,
    env: { ...process.env, VITE_API_PROXY_TARGET: api },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  try {
    await waitForHttp('http://localhost:4173/', 30000);
  } catch {
    stopPreview(child);
    throw new Error(`vite preview did not start on port 4173:\n${log}`);
  }
  return child;
}

function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill();
    else process.kill(-child.pid, 'SIGTERM');
  } catch {}
}

const ENGINES = { chromium, firefox, webkit };

function launchOptions(engine, browserPath) {
  if (engine !== 'chromium') return {};
  if (browserPath) return { executablePath: browserPath };
  if (existsSync('/opt/pw-browsers/chromium')) return { executablePath: '/opt/pw-browsers/chromium' };
  return { channel: 'chrome' };
}

/**
 * The context a page is looked at in. At phone width it is a phone's: a mobile viewport with touch, where the
 * engine has one (Firefox's does not exist, so there it is the narrow window alone).
 */
function contextOptions(state, width, locale, { motion, forced = false }) {
  const mobile = width < 800;
  return {
    viewport: { width, height: mobile ? 844 : 900 },
    deviceScaleFactor: 1,
    ...(state.opts.engine === 'firefox' ? {} : { isMobile: mobile }),
    hasTouch: mobile,
    colorScheme: state.opts.theme,
    reducedMotion: motion ? 'no-preference' : 'reduce',
    forcedColors: forced ? 'active' : 'none',
    locale: locale === 'he' ? 'he-IL' : 'en-US',
  };
}

async function apiCall(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      return { status: res.status, json, text };
    },
    { method, path, body },
  );
}

async function signIn(page, persona, opts, secrets) {
  const login = PERSONAS[persona].login;
  const first = await apiCall(page, 'POST', '/auth/login', { identifier: login, password: opts.password });
  if (first.status !== 200) throw new Error(`Sign-in as ${login} failed (${first.status}): ${first.text}`);
  if (first.json?.status === 'mfa_required') {
    const secret = secrets[login];
    if (!secret) {
      throw new Error(
        `${login} already has two-factor on, and its secret is not in .totp.json. Reseed the database ` +
          '(pnpm db:reset) so the script can enrol it again.',
      );
    }
    const second = await apiCall(page, 'POST', '/auth/login/mfa', {
      challengeToken: first.json.challengeToken,
      code: await freshCode(login, secret),
    });
    if (second.status !== 200) throw new Error(`Second factor for ${login} failed (${second.status}): ${second.text}`);
  }
  return first.json;
}

async function enrol(page, persona, opts, secrets) {
  const login = PERSONAS[persona].login;
  const setup = await apiCall(page, 'POST', '/auth/mfa/setup');
  if (setup.status !== 200) throw new Error(`Two-factor setup for ${login} failed (${setup.status}): ${setup.text}`);
  const secret = setup.json.secret;
  const code = await freshCode(login, secret);
  const confirm = await apiCall(page, 'POST', '/auth/mfa/confirm', { password: opts.password, code });
  if (confirm.status !== 200) {
    throw new Error(`Two-factor confirmation for ${login} failed (${confirm.status}): ${confirm.text}`);
  }
  secrets[login] = secret;
}

async function open(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
}

// How long a page is given to finish arriving before it is looked at: with motion on, its entrances are
// part of it.
let settleMs = 250;

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page
    .waitForFunction(() => !globalThis.document.querySelector('[aria-busy="true"], .skeleton, .boot'), null, { timeout: 10000 })
    .catch(() => {});
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page
    .waitForFunction(() => [...globalThis.document.images].every((img) => img.complete), null, { timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(settleMs);
}

/**
 * Opens what a visitor opens, with motion on, and measures it where it is: each menu in the header, the
 * drawer a card opens, the photograph, and that each is on screen, covers what it should and can be reached
 * (a menu that is drawn but cannot be clicked, a backdrop that is a box inside a tile, a sheet that starts
 * off the edge of a phone). A static capture sees none of this: an entrance that is still in flight, or a
 * box that moves what is fixed inside it, only shows when the thing is opened.
 */
async function auditOverlays(state, browser, persona, locale, width) {
  const context = await browser.newContext(contextOptions(state, width, locale, { motion: true }));
  await context.addInitScript(
    ([l, t]) => {
      try {
        globalThis.localStorage.setItem('bault.locale', l);
        globalThis.localStorage.setItem('bault.theme', t);
      } catch {}
    },
    [locale, state.opts.theme],
  );
  const page = await context.newPage();
  const record = async (name, flags) => {
    const file = `${slug(`${persona}-${name}`)}-${locale}-${width}.png`;
    await page.screenshot({ path: join(state.outDir, file) });
    state.shots.push({ name: `${persona}-${name}`, persona, locale, width, file, title: name, flags });
    process.stdout.write(flags.length ? '!' : '.');
  };
  // Where something that is open actually is: on screen, as large as it should be, and the thing under a
  // point inside it is it (and not what it is drawn over).
  const measure = (selector, { covers = false, label }) =>
    page.evaluate(
      ({ selector, covers, label }) => {
        const { document, window, getComputedStyle } = globalThis;
        const el = [...document.querySelectorAll(selector)].find((node) => node.checkVisibility?.({ checkVisibilityCSS: true }));
        if (!el) return [`${label}: nothing visible matches ${selector}`];
        const out = [];
        const box = el.getBoundingClientRect();
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (covers) {
          if (box.width < w - 1 || box.height < h - 1 || box.left > 1 || box.top > 1) {
            out.push(`${label} covers ${Math.round(box.width)}x${Math.round(box.height)} of a ${w}x${h} window, from (${Math.round(box.left)}, ${Math.round(box.top)})`);
          }
        } else {
          const scrolls = ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && box.height <= h + 1;
          if (box.left < -1 || box.right > w + 1 || box.top < -1 || (box.bottom > h + 1 && !scrolls)) {
            out.push(`${label} is not on screen: (${Math.round(box.left)}, ${Math.round(box.top)}) to (${Math.round(box.right)}, ${Math.round(box.bottom)}) in a ${w}x${h} window`);
          }
        }
        const x = Math.min(w - 2, Math.max(2, box.left + Math.min(box.width, w) / 2));
        const y = Math.min(h - 2, Math.max(2, box.top + Math.min(box.height, h) / 2));
        const top = document.elementFromPoint(x, y);
        // A backdrop is behind what it backs: the middle of it is the dialog's, not its own.
        if (!covers && (!top || !(el.contains(top) || top.contains(el)))) {
          out.push(`${label} cannot be reached: at (${Math.round(x)}, ${Math.round(y)}) there is ${top ? `${top.tagName.toLowerCase()}${top.className && typeof top.className === 'string' ? '.' + top.className.trim().split(/\s+/)[0] : ''}` : 'nothing'}`);
        }
        return out;
      },
      { selector, covers, label },
    );
  try {
    await page.goto(`${state.baseUrl}/#/`);
    await settle(page);
    await signIn(page, persona, state.opts, state.secrets);
    await open(page, `${state.baseUrl}/#/vault`);
    await settle(page);

    // The header's menus: the language, the notifications, the account.
    const triggers = [];
    for (const handle of await page.$$('[aria-haspopup]')) if (await handle.isVisible()) triggers.push(handle);
    for (let index = 0; index < triggers.length; index += 1) {
      const trigger = triggers[index];
      const label = (await trigger.getAttribute('aria-label')) || (await trigger.innerText()).trim().slice(0, 20) || `menu ${index + 1}`;
      await trigger.click();
      await page.waitForTimeout(900);
      const flags = await measure('.pop, [role="menu"], [role="dialog"]:not(.modal):not(.drawer)', { label: `the "${label}" menu` });
      await record(`menu-${index + 1}`, flags);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const closed = await page.evaluate(() => !globalThis.document.querySelector('.pop') && globalThis.document.activeElement?.getAttribute('aria-haspopup') !== null);
      if (!closed) state.shots[state.shots.length - 1].flags.push(`the "${label}" menu does not close on Escape, or does not give focus back`);
    }

    // The drawer a card opens, and the photograph in it.
    const card = await page.$('.card-hit');
    if (card) {
      await card.click({ force: true });
      await page.waitForSelector('[role="dialog"]', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const drawerFlags = [
        ...(await measure('.drawer-backdrop', { covers: true, label: 'the drawer\'s backdrop' })),
        ...(await measure('.drawer', { label: 'the drawer' })),
      ];
      await record('drawer', drawerFlags);
      const photo = await page.$('.drawer .photo-btn, .drawer .photo-thumb');
      if (photo) {
        await photo.click({ force: true });
        await page.waitForSelector('.lightbox', { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1000);
        const lightFlags = [
          ...(await measure('.lightbox', { covers: true, label: 'the photograph\'s room' })),
          ...(await measure('.lightbox-close', { label: 'the photograph\'s close button' })),
          // A card with no photograph has the words that say so in its place: the room is measured either way.
          ...(await measure('.lightbox .modal-slab, .lightbox .photo-thumb, .lightbox .modal-empty', { label: 'the photograph (or the words that say there is none)' })),
        ];
        await record('photograph', lightFlags);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const stillOpen = await page.evaluate(() => !!globalThis.document.querySelector('.lightbox') );
        if (stillOpen) state.shots[state.shots.length - 1].flags.push('the photograph does not close on Escape');
      }
      await page.keyboard.press('Escape');
    }
  } catch (error) {
    state.shots.push({ name: `${persona}-overlays`, persona, locale, width, file: '', title: 'overlays', flags: [`the overlay pass failed: ${error.message.slice(0, 140)}`] });
  } finally {
    await context.close();
  }
}

function slug(value) {
  return value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

async function capture(state, page, name, ctx) {
  if (state.opts.only && !name.includes(state.opts.only)) return;
  await settle(page);
  // Every screen is looked at from its top, as a visitor arrives at it: a page that has been left scrolled (by the
  // one before it) has its sticky bar over its header, and a target that is under the bar is "partially obscured".
  await page.evaluate(() => globalThis.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  const file = `${slug(name)}-${ctx.locale}-${ctx.width}.png`;
  await page.screenshot({ path: join(state.outDir, file), fullPage: true });
  const found = await inspect(page, ctx.locale, ctx.width);
  const accessibility = state.opts.axe ? await audit(page, { forced: state.opts.forced }) : [];
  if (state.opts.axe) accessibility.push(...(await auditFocus(page, state.opts.focusStops)));
  if (ctx.forced) accessibility.push(...(await auditForced(page)));
  const theme = await auditTheme(page, state.opts.theme);
  const buttons = await auditButtons(page);
  const flags = [...found.flags, ...theme, ...buttons, ...accessibility, ...ctx.problems.splice(0)];
  state.shots.push({ name, persona: ctx.persona, locale: ctx.locale, width: ctx.width, file, title: found.title, flags });
  process.stdout.write(flags.length ? '!' : '.');
}

/**
 * Opens the first record the screen has (a row of a roll, a parcel's label, a guide, a question) and captures it
 * as the screen it then is. What the click adds to the address says what was opened; a click that adds nothing
 * opened nothing the address names (a menu, a card with no record behind it) and is let go.
 */
async function visitRecord(state, page, name, ctx) {
  const recordName = `${name}-record`;
  if (state.opts.only && !recordName.includes(state.opts.only)) return;
  // What a screen lists arrives after the screen does.
  await settle(page);
  const keysOf = () =>
    page.evaluate(() => [...new globalThis.URLSearchParams(globalThis.location.hash.split('?')[1] ?? '').keys()]);
  const before = await keysOf();
  for (const selector of RECORD_OPENERS) {
    const opener = page.locator(`main ${selector}`).first();
    if (!(await opener.count())) continue;
    await opener.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const added = (await keysOf()).filter((key) => !before.includes(key));
    if (added.length === 0) {
      await page.keyboard.press('Escape');
      continue;
    }
    for (const kind of added) state.opened.add(kind);
    await capture(state, page, recordName, ctx);
    return;
  }
}

async function visitSection(state, page, section, ctx) {
  await page.goto(`${state.baseUrl}/#/${section}`);
  await settle(page);
  const landed = await page.evaluate(() => globalThis.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]);
  if (landed !== section) {
    ctx.problems.length = 0;
    return;
  }
  const tabs = await page.$$eval('[role="tablist"] [role="tab"]', (els) =>
    els.map((el) => el.id.replace(/^tab-/, '')).filter(Boolean),
  );
  if (tabs.length === 0) {
    await capture(state, page, `${ctx.persona}-${section}`, ctx);
    await visitRecord(state, page, `${ctx.persona}-${section}`, ctx);
    return;
  }
  for (const tab of tabs) {
    await page.goto(`${state.baseUrl}/#/${section}/${tab}`);
    await capture(state, page, `${ctx.persona}-${section}-${tab}`, ctx);
    await visitRecord(state, page, `${ctx.persona}-${section}-${tab}`, ctx);
  }
}

async function visitItems(state, page, ctx) {
  for (const scope of VAULT_SCOPES) {
    const list = await apiCall(page, 'GET', `/vault/items?scope=${scope}`);
    const first = Array.isArray(list.json) ? list.json[0] : null;
    if (!first) continue;
    await page.goto(`${state.baseUrl}/#/vault/${scope}?item=${encodeURIComponent(first.id)}`);
    state.opened.add('item');
    await capture(state, page, `${ctx.persona}-item-${scope}`, ctx);
  }
}

/**
 * What the management console opens: an account, an item and a wallet request, each in the drawer it is
 * changed in (by the link that names it, as the roll's own names are), so that what is drawn there is held to
 * what the pages are.
 */
async function visitAdminRecords(state, page, ctx) {
  const users = await apiCall(page, 'GET', '/admin/users');
  const items = await apiCall(page, 'GET', '/admin/items');
  const requests = await apiCall(page, 'GET', '/admin/wallet-requests');
  const me = await apiCall(page, 'GET', '/me/profile');
  // An enrolled account that is not the one signed in: the drawer of one's own account has no reset button, and
  // the reset (its button, its confirmation, where focus goes after) is what an administrator's drawer is for.
  const others = Array.isArray(users.json) ? users.json.filter((u) => u.id !== me.json?.id) : [];
  const records = [
    ['users', 'user', others.find((u) => u.mfaEnabled) ?? others[0] ?? null],
    ['items', 'item', Array.isArray(items.json) ? items.json[0] : null],
    // A request that waits for a decision, where there is one: its drawer has the steps (approve, reject) that a closed one has not.
    [
      'requests',
      'request',
      Array.isArray(requests.json)
        ? (requests.json.find((r) => r.status === 'submitted' || r.status === 'pending_review') ??
          requests.json[0] ??
          null)
        : null,
    ],
  ];
  for (const [tab, param, record] of records) {
    if (!record) continue;
    await page.goto(`${state.baseUrl}/#/admin/${tab}?${param}=${encodeURIComponent(record.id)}`);
    state.opened.add(param);
    await capture(state, page, `${ctx.persona}-${tab}-drawer`, ctx);
  }
}

/** A ticket in the operator's queue, in the drawer it is answered in (a queue's rows are not what opens it). */
async function visitQueueTicket(state, page, ctx) {
  const queue = await apiCall(page, 'GET', '/support/queue');
  const first = Array.isArray(queue.json) ? queue.json[0] : null;
  if (!first) return;
  await page.goto(`${state.baseUrl}/#/warehouse/support?ticket=${encodeURIComponent(first.id)}`);
  state.opened.add('ticket');
  await capture(state, page, `${ctx.persona}-support-ticket`, ctx);
}

async function runPersona(state, browser, persona, locale, width) {
  const context = await browser.newContext(
    contextOptions(state, width, locale, { motion: state.opts.motion, forced: state.opts.forced }),
  );
  await context.addInitScript(
    ([l, t]) => {
      try {
        globalThis.localStorage.setItem('bault.locale', l);
        globalThis.localStorage.setItem('bault.theme', t);
      } catch {}
    },
    [locale, state.opts.theme],
  );
  const page = await context.newPage();
  const ctx = { persona, locale, width, problems: [], expected: [], forced: state.opts.forced };
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
      ctx.problems.push(`console: ${msg.text().slice(0, 160)}`);
    }
  });
  page.on('pageerror', (err) => ctx.problems.push(`page error: ${err.message.slice(0, 160)}`));
  page.on('response', (res) => {
    const status = res.status();
    if (status < 400 || status === 401) return;
    const path = new URL(res.url()).pathname;
    if (!path.startsWith('/api/')) ctx.problems.push(`missing file ${status}: ${path}`);
    else if (status >= 500 || !ctx.expected.includes(status)) ctx.problems.push(`API ${status}: ${path}`);
  });
  try {
    await page.goto(`${state.baseUrl}/#/`);
    await settle(page);
    if (persona === 'anonymous') {
      for (const [name, hash, expected = []] of ANONYMOUS_ROUTES) {
        ctx.expected = expected;
        await open(page, `${state.baseUrl}/${hash}`);
        await capture(state, page, `anonymous-${name}`, ctx);
      }
      ctx.expected = [];
      return;
    }
    const spec = PERSONAS[persona];
    const login = spec.login;
    if (spec.staff && !state.secrets[login]) {
      const session = await signIn(page, persona, state.opts, state.secrets);
      await open(page, `${state.baseUrl}/#/${session?.mfaEnrollmentRequired ? '' : 'profile/security'}`);
      await capture(state, page, `${persona}-two-factor-enrolment`, ctx);
      const start = page.getByRole('button', { name: /^(Set up two-factor sign-in|הגדרת אימות דו־שלבי)$/ }).first();
      if (await start.isEnabled({ timeout: 5000 }).catch(() => false)) {
        await start.click();
        await page.waitForSelector('img[src^="data:image/svg+xml"]', { timeout: 10000 }).catch(() => {});
        await capture(state, page, `${persona}-two-factor-enrolment-code`, ctx);
      }
      await enrol(page, persona, state.opts, state.secrets);
      writeFileSync(state.secretsFile, JSON.stringify(state.secrets, null, 2));
      await apiCall(page, 'POST', '/auth/logout');
    }
    if (spec.staff) {
      await open(page, `${state.baseUrl}/#/signin`);
      await settle(page);
      await page.fill('input[autocomplete="username"]', login);
      await page.fill('input[autocomplete="current-password"]', state.opts.password);
      await page.click('button[type="submit"]');
      await page.waitForSelector('input[autocomplete="one-time-code"]', { timeout: 10000 });
      await capture(state, page, `${persona}-two-factor-sign-in`, ctx);
      await open(page, `${state.baseUrl}/#/`);
    }
    await signIn(page, persona, state.opts, state.secrets);
    await open(page, `${state.baseUrl}/#/vault`);
    await settle(page);
    for (const section of spec.sections ?? SECTIONS) await visitSection(state, page, section, ctx);
    if (persona === 'collector') await visitItems(state, page, ctx);
    if (persona === 'operator') await visitQueueTicket(state, page, ctx);
    if (persona === 'admin') await visitAdminRecords(state, page, ctx);
  } finally {
    await context.close();
  }
  if (persona !== 'anonymous' && state.opts.overlays && (!state.opts.only || state.opts.only === 'overlay')) {
    await auditOverlays(state, browser, persona, locale, width);
  }
}

async function captureEmails(state, browser) {
  const built = join(repoRoot, 'packages/adapters/dist/index.js');
  if (!existsSync(built)) {
    console.log('\nNo build of @bault/adapters, so the emails are skipped. Run `pnpm --filter "./packages/*" build`.');
    return;
  }
  const { renderEmail } = await import(pathToFileURL(built).href);
  const link = 'https://bault.example/#/verify-email?token=example-token';
  for (const template of ['email_verification', 'password_reset']) {
    for (const width of state.opts.widths) {
      const name = `email-${template.replace(/_/g, '-')}`;
      if (state.opts.only && !name.includes(state.opts.only)) continue;
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const email = renderEmail(template, { link });
      // The harness is a document with a language and a title, so that what the audit says is about the message.
      await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${email.subject ?? template}</title><body style="margin:0;background:#ffffff">${email.html}</body></html>`);
      const file = `${name}-he-en-${width}.png`;
      await page.screenshot({ path: join(state.outDir, file), fullPage: true });
      // Both languages are in the one message by design, so what is looked for is the layout and, in the
      // Hebrew, the order of what is drawn; not English words on a Hebrew page.
      const found = await inspect(page, 'mixed', width);
      const accessibility = state.opts.axe ? await audit(page, { forced: state.opts.forced }) : [];
      state.shots.push({ name, persona: 'email', locale: 'he+en', width, file, title: template, flags: [...found.flags, ...accessibility] });
      await context.close();
      process.stdout.write('.');
    }
  }
}

function contactSheet(shots) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const groups = new Map();
  for (const shot of shots) {
    if (!groups.has(shot.name)) groups.set(shot.name, []);
    groups.get(shot.name).push(shot);
  }
  const ordered = [...groups.entries()].sort(
    ([a, x], [b, y]) =>
      Number(y.some((s) => s.flags.length)) - Number(x.some((s) => s.flags.length)) || a.localeCompare(b),
  );
  const flagged = ordered.filter(([, list]) => list.some((s) => s.flags.length)).length;
  const sections = ordered
    .map(([name, list]) => {
      const flags = [...new Set(list.flatMap((s) => s.flags.map((f) => `${s.locale} ${s.width}: ${f}`)))];
      const figures = list
        .map(
          (s) =>
            `<figure><a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}" alt="${esc(`${name} ${s.locale} ${s.width}`)}"></a><figcaption>${esc(s.locale)} · ${s.width}px</figcaption></figure>`,
        )
        .join('');
      const flagList = flags.length ? `<ul class="flags">${flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
      return `<section id="${esc(name)}"><h2>${esc(name)}</h2>${flagList}<div class="row">${figures}</div></section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bault screens</title>
<style>
:root { color-scheme: light; --ink: #111318; --muted: #676c74; --line: #dcded9; --page: #f3f4f2; --flag: #8c2b2b; }
body { margin: 0; padding: 24px 16px; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, sans-serif; }
h1 { font-size: 22px; margin: 0 0 4px; }
p.meta { color: var(--muted); margin: 0 0 24px; }
section { border-top: 1px solid var(--line); padding: 16px 0; }
h2 { font-size: 16px; margin: 0 0 8px; font-family: ui-monospace, monospace; }
.flags { color: var(--flag); margin: 0 0 12px; padding-inline-start: 20px; }
.row { display: flex; gap: 12px; overflow-x: auto; align-items: flex-start; }
figure { margin: 0; flex: none; }
figure img { display: block; width: 240px; height: auto; border: 1px solid var(--line); background: #fff; }
figcaption { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<h1>Bault screens</h1>
<p class="meta">${shots.length} captures of ${groups.size} screens · ${flagged} with automatic flags, listed first · ${new Date().toISOString()}</p>
${sections}
</body>
</html>
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  settleMs = opts.motion ? 1400 : 250;
  const outDir = resolve(repoRoot, opts.out);
  assertLocal(opts.baseUrl ?? opts.api);
  mkdirSync(outDir, { recursive: true });
  const secretsFile = join(outDir, '.totp.json');
  const secrets = existsSync(secretsFile) ? JSON.parse(readFileSync(secretsFile, 'utf8')) : {};
  let preview = null;
  if (!opts.baseUrl) preview = await startPreview(opts.api);
  const baseUrl = (opts.baseUrl ?? 'http://localhost:4173').replace(/\/+$/, '');
  const state = { opts, outDir, baseUrl, secrets, secretsFile, shots: [], opened: new Set() };
  const browser = await ENGINES[opts.engine].launch(launchOptions(opts.engine, opts.browser));
  try {
    for (const file of ['index.html', 'shots.json']) rmSync(join(outDir, file), { force: true });
    for (const persona of opts.personas) {
      for (const locale of opts.locales) {
        for (const width of opts.widths) {
          process.stdout.write(`\n${persona} ${locale} ${width} `);
          await runPersona(state, browser, persona, locale, width);
        }
      }
    }
    process.stdout.write('\nemails ');
    await captureEmails(state, browser);
  } finally {
    await browser.close();
    stopPreview(preview);
    writeFileSync(join(outDir, 'shots.json'), JSON.stringify(state.shots, null, 2));
    writeFileSync(join(outDir, 'index.html'), contactSheet(state.shots));
  }
  const flagged = state.shots.filter((s) => s.flags.length).length;
  // The kinds of record the app opens against the kinds this run opened. A run of some of the accounts opens some
  // of them; the runs of all the accounts, together, have to open every one (records.json is what they add up).
  const known = recordKindsOfTheApp();
  const opened = [...state.opened].sort();
  writeFileSync(join(outDir, 'records.json'), JSON.stringify({ known, opened }, null, 2));
  console.log(`\nRecords opened: ${opened.join(', ') || 'none'}; the app opens: ${known.join(', ')}.`);
  console.log(`${state.shots.length} captures, ${flagged} with flags. Open ${join(opts.out, 'index.html')}`);
}

// Run when it is the script being run, not when its checks are imported (the tests that plant a mistake
// and see whether it is flagged do that).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
