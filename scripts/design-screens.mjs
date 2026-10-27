#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright-core';

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
                     of each desktop English screen to measure every focus ring against
                     what is behind it (axe does not check focus indicators); what it
                     finds is listed as flags
  --only <text>      capture only screens whose name contains this text
  --browser <path>   Chromium or Chrome to drive (default /opt/pw-browsers/chromium
                     when it exists, otherwise the installed Google Chrome)
  --password <pw>    the seeded accounts' password (default 11111111)

Open <out>/index.html when it finishes. Screens with automatic flags (an id,
cents, an enum name or English words on a Hebrew page, sideways scrolling at
phone width, a console error, a failed API call or, with --axe, an accessibility
violation) are listed first.`;

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
    only: null,
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
    else if (flag === '--only') out.only = value();
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

function launchOptions(browserPath) {
  if (browserPath) return { executablePath: browserPath };
  if (existsSync('/opt/pw-browsers/chromium')) return { executablePath: '/opt/pw-browsers/chromium' };
  return { channel: 'chrome' };
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

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page
    .waitForFunction(() => !globalThis.document.querySelector('[aria-busy="true"], .skeleton, .boot'), null, { timeout: 10000 })
    .catch(() => {});
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page
    .waitForFunction(() => [...globalThis.document.images].every((img) => img.complete), null, { timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(250);
}

async function inspect(page, locale, width) {
  return page.evaluate(
    ({ locale, width }) => {
      const { document, window, NodeFilter } = globalThis;
      const ISOLATES = '.serial, .amount, .ltr-run, .code-inline, .bidi, [dir="ltr"], code, kbd, input, textarea, select, script, style';
      const flags = [];
      const text = document.body.innerText;
      const uuid = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
      if (uuid) flags.push(`id on screen: ${uuid[0]}`);
      const cents = text.match(/\b\d[\d,]*\s*cents\b/i);
      if (cents) flags.push(`minor units on screen: ${cents[0]}`);
      const enums = [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])].filter((w) => !w.includes('@'));
      if (enums.length) flags.push(`enum names on screen: ${enums.slice(0, 6).join(', ')}`);
      if (document.documentElement.scrollWidth > window.innerWidth + 1 && width < 800) {
        flags.push(`scrolls sideways: ${document.documentElement.scrollWidth}px wide at ${window.innerWidth}px`);
      }
      const foreign = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || el.closest(ISOLATES) || !el.checkVisibility?.()) continue;
        const value = node.textContent ?? '';
        if (locale === 'he') {
          for (const word of value.match(/(?<![\p{L}\d])[a-z][a-z'’]{2,}(?![\p{L}\d])/gu) ?? []) foreign.push(word);
        } else if (/[֐-׿]/.test(value)) {
          foreign.push(value.trim().slice(0, 40));
        }
      }
      if (foreign.length) {
        const sample = [...new Set(foreign)].slice(0, 8).join(', ');
        flags.push(locale === 'he' ? `English words on a Hebrew page: ${sample}` : `Hebrew on an English page: ${sample}`);
      }
      return { flags, title: document.title };
    },
    { locale, width },
  );
}

/**
 * axe-core's WCAG 2.x A and AA rules over the page as it stands. Contrast is
 * the reason this exists: it is measured against the computed colours of
 * whichever theme is on screen, which no reading of the stylesheet can do.
 * Motion is reduced for the whole run, so nothing is mid-fade when it looks.
 */
async function audit(page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return result.violations.map((v) => {
    const target = v.nodes[0]?.target?.join(' ') ?? '';
    return `axe ${v.id} (${v.impact}) x${v.nodes.length}: ${target}`.slice(0, 200);
  });
}

/**
 * Tabs through the first stops of the page and measures the focus indicator of
 * each against the colour behind it. A ring that is absent, or under 3:1
 * (WCAG 1.4.11), is a flag. The colour behind is the nearest opaque background
 * up the tree; where something with an image or gradient comes first the
 * contrast is not known and is not reported.
 */
async function auditFocus(page, stops = 30) {
  const flags = [];
  await page.evaluate(() => {
    globalThis.document.activeElement?.blur?.();
    globalThis.scrollTo(0, 0);
  });
  const seen = new Set();
  for (let i = 0; i < stops; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const { document, getComputedStyle } = globalThis;
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { end: true };
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return { skip: true };
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = (css) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: a / 255 };
      };
      const lum = ({ r, g, b }) => {
        const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const over = (top, under) => ({
        r: top.r * top.a + under.r * (1 - top.a),
        g: top.g * top.a + under.g * (1 - top.a),
        b: top.b * top.a + under.b * (1 - top.a),
        a: 1,
      });
      const cs = getComputedStyle(el);
      const name = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`;
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30);
      // The element draws its own ring, or a wrapper does (a search box rings the
      // box around its input, with :focus-within).
      const ringOf = (node) => {
        const style = getComputedStyle(node);
        if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) {
          return { css: style.outlineColor, inside: parseFloat(style.outlineOffset) < 0 };
        }
        // A shadow is a ring only if it is a solid band round the box: no offset, no blur, a spread.
        const band = /(rgba?\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|color\([^)]*\))\s+0px\s+0px\s+0px\s+(?:[2-9]|\d{2,})px/.exec(
          style.boxShadow,
        );
        if (band) return { css: band[1], inside: false };
        return null;
      };
      let ringNode = el;
      let ring = ringOf(el);
      for (let up = el.parentElement, hops = 0; !ring && up && hops < 3; up = up.parentElement, hops += 1) {
        ring = ringOf(up);
        ringNode = up;
      }
      if (!ring) return { name, label, none: true };
      // What is behind the ring: the nearest opaque background, from the element (ring inside it) or its parent.
      let node = ring.inside ? ringNode : ringNode.parentElement;
      let under = null;
      const layers = [];
      for (; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage !== 'none') {
          const alpha = rgba(style.backgroundColor).a;
          if (alpha < 1) return { name, label, unknown: true };
        }
        const bg = rgba(style.backgroundColor);
        if (bg.a > 0) layers.push(bg);
        if (bg.a >= 1) break;
      }
      if (layers.length === 0 || layers[layers.length - 1].a < 1) layers.push({ r: 255, g: 255, b: 255, a: 1 });
      under = layers.reduceRight((acc, layer) => over(layer, acc), { r: 255, g: 255, b: 255, a: 1 });
      const fg = over(rgba(ring.css), under);
      const [hi, lo] = [lum(fg), lum(under)].sort((a, b) => b - a);
      return { name, label, ratio: (hi + 0.05) / (lo + 0.05) };
    });
    if (stop.end) break;
    if (stop.skip || stop.unknown) continue;
    const key = `${stop.name}|${stop.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (stop.none) flags.push(`focus: no visible indicator on ${stop.name} "${stop.label}"`);
    else if (stop.ratio < 3) flags.push(`focus: ring ${stop.ratio.toFixed(2)}:1 on ${stop.name} "${stop.label}"`);
  }
  return flags;
}

function slug(value) {
  return value.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

async function capture(state, page, name, ctx) {
  if (state.opts.only && !name.includes(state.opts.only)) return;
  await settle(page);
  const file = `${slug(name)}-${ctx.locale}-${ctx.width}.png`;
  await page.screenshot({ path: join(state.outDir, file), fullPage: true });
  const found = await inspect(page, ctx.locale, ctx.width);
  const accessibility = state.opts.axe ? await audit(page) : [];
  if (state.opts.axe && ctx.locale === 'en' && ctx.width >= 800) accessibility.push(...(await auditFocus(page)));
  const flags = [...found.flags, ...accessibility, ...ctx.problems.splice(0)];
  state.shots.push({ name, persona: ctx.persona, locale: ctx.locale, width: ctx.width, file, title: found.title, flags });
  process.stdout.write(flags.length ? '!' : '.');
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
    return;
  }
  for (const tab of tabs) {
    await page.goto(`${state.baseUrl}/#/${section}/${tab}`);
    await capture(state, page, `${ctx.persona}-${section}-${tab}`, ctx);
  }
}

async function visitItems(state, page, ctx) {
  for (const scope of VAULT_SCOPES) {
    const list = await apiCall(page, 'GET', `/vault/items?scope=${scope}`);
    const first = Array.isArray(list.json) ? list.json[0] : null;
    if (!first) continue;
    await page.goto(`${state.baseUrl}/#/vault/${scope}?item=${encodeURIComponent(first.id)}`);
    await capture(state, page, `${ctx.persona}-item-${scope}`, ctx);
  }
}

async function runPersona(state, browser, persona, locale, width) {
  const mobile = width < 800;
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: state.opts.theme,
    reducedMotion: 'reduce',
    locale: locale === 'he' ? 'he-IL' : 'en-US',
  });
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
  const ctx = { persona, locale, width, problems: [], expected: [] };
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
  } finally {
    await context.close();
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
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#ffffff">${renderEmail(template, { link }).html}</body>`);
      const file = `${name}-he-en-${width}.png`;
      await page.screenshot({ path: join(state.outDir, file), fullPage: true });
      state.shots.push({ name, persona: 'email', locale: 'he+en', width, file, title: template, flags: [] });
      await page.close();
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
  const outDir = resolve(repoRoot, opts.out);
  assertLocal(opts.baseUrl ?? opts.api);
  mkdirSync(outDir, { recursive: true });
  const secretsFile = join(outDir, '.totp.json');
  const secrets = existsSync(secretsFile) ? JSON.parse(readFileSync(secretsFile, 'utf8')) : {};
  let preview = null;
  if (!opts.baseUrl) preview = await startPreview(opts.api);
  const baseUrl = (opts.baseUrl ?? 'http://localhost:4173').replace(/\/+$/, '');
  const state = { opts, outDir, baseUrl, secrets, secretsFile, shots: [] };
  const browser = await chromium.launch(launchOptions(opts.browser));
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
  console.log(`\n${state.shots.length} captures, ${flagged} with flags. Open ${join(opts.out, 'index.html')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
