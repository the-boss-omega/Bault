#!/usr/bin/env node
/**
 * `pnpm tunnel` — show the running app to somebody who is not on this machine,
 * safely, in one command.
 *
 * Doing this by hand took five steps and every one of them had a way to go
 * wrong that looked like success:
 *
 *   - tunnelling `pnpm dev` instead of the build serves the SOURCE — every
 *     `/src/**\/*.tsx` answers with the file (DIVE1 Part 43);
 *   - a `vite build` run with the root `.env` in reach produced a DEVELOPMENT
 *     bundle with a working password pre-typed into the sign-in form
 *     (Part 45, fixed in `vite.config.ts`);
 *   - a quick tunnel has no password of its own, and behind it sits an API whose
 *     seeded accounts — the administrator included — share one;
 *   - the local `.env` raises the sign-in rate limit for the test suite, so the
 *     brute-force protection a stranger would meet is effectively off.
 *
 * So this does it in the right order and refuses the unsafe shortcuts:
 *
 *   1. checks the API is up (the preview proxies `/api` to it);
 *   2. warns, loudly, if the sign-in rate limit is above the production default;
 *   3. builds the web app — always, so the tunnel never serves a stale bundle;
 *   4. starts `vite preview` with a password in front of EVERYTHING, `/api`
 *      included — generated fresh unless `WEB_PREVIEW_PASSWORD` is set;
 *   5. starts a Cloudflare quick tunnel and prints the link AND the password.
 *
 * Ctrl+C stops both. The link dies with them, which is also the kill switch.
 *
 * Plain Node, like `dev.mjs`: no new dependency, same behaviour on every OS.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const PREVIEW_PORT = 4173;
/** The schema default for `AUTH_RATE_LIMIT_PER_MINUTE` in `packages/config`. */
const AUTH_LIMIT_DEFAULT = 30;

function readEnvFile(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = readEnvFile(join(repoRoot, '.env'));
const env = { ...fileEnv, ...process.env };
const apiBase = `http://127.0.0.1:${env.API_PORT || 3000}`;

const say = (msg) => process.stdout.write(`[tunnel] ${msg}\n`);
const fail = (msg) => {
  process.stderr.write(`[tunnel] ${msg}\n`);
  process.exit(1);
};

/* ---------------------------------------------------------------- 1. API up */

try {
  const res = await fetch(`${apiBase}/api/v1/healthz`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  fail(`The API is not answering at ${apiBase} (${e.message}). Start it with \`pnpm dev\` first.`);
}
say(`API is up at ${apiBase}`);

/* ------------------------------------------------------- 2. rate-limit check */

const authLimit = Number(env.AUTH_RATE_LIMIT_PER_MINUTE || AUTH_LIMIT_DEFAULT);
if (authLimit > AUTH_LIMIT_DEFAULT) {
  say('');
  say(`WARNING: AUTH_RATE_LIMIT_PER_MINUTE is ${authLimit} (production default ${AUTH_LIMIT_DEFAULT}).`);
  say('  The integration suite needs it high; a public link does not. A stranger who gets');
  say('  past the preview password could try that many passwords a minute. To tighten it:');
  say(`  set AUTH_RATE_LIMIT_PER_MINUTE=${AUTH_LIMIT_DEFAULT} in .env and restart the API.`);
  say('');
}

/* ---------------------------------------------------------------- 3. build */

say('Building the web app (always — a stale bundle is how old bugs come back)…');
const build = spawnSync('pnpm --filter @bault/web build', { cwd: repoRoot, shell: true, stdio: 'inherit' });
if (build.status !== 0) fail('The build failed. Nothing has been exposed.');

/* ------------------------------------------------- 4. preview with a password */

const user = env.WEB_PREVIEW_USER || 'bault';
const password = env.WEB_PREVIEW_PASSWORD || randomBytes(12).toString('base64url');

// Quick-tunnel hostnames are random, so allow the whole domain for this run.
const hosts = new Set((env.WEB_PUBLIC_HOST || '').split(',').map((h) => h.trim()).filter(Boolean));
hosts.add('.trycloudflare.com');

const children = [];
function run(command, extraEnv) {
  const child = spawn(command, {
    cwd: repoRoot,
    shell: true,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return child;
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (isWindows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

function shutdown(code = 0) {
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const preview = run(`pnpm --filter @bault/web exec vite preview --port ${PREVIEW_PORT} --strictPort`, {
  WEB_PREVIEW_USER: user,
  WEB_PREVIEW_PASSWORD: password,
  WEB_PUBLIC_HOST: [...hosts].join(','),
});
preview.stderr.on('data', (d) => process.stderr.write(d));
preview.on('exit', (code) => {
  say(`The preview server stopped (exit ${code}). Stopping the tunnel.`);
  shutdown(code ?? 1);
});

// Wait for the preview to answer — with a 401, which is the point.
const deadline = Date.now() + 30_000;
for (;;) {
  try {
    const res = await fetch(`http://127.0.0.1:${PREVIEW_PORT}/`);
    if (res.status === 401) break;
    if (res.ok) fail('The preview answered WITHOUT asking for a password. Refusing to open a tunnel to it.');
  } catch {
    /* not up yet */
  }
  if (Date.now() > deadline) fail(`The preview did not start on port ${PREVIEW_PORT}. Is it already in use?`);
  await new Promise((r) => setTimeout(r, 500));
}
say(`Preview is serving the build on ${PREVIEW_PORT}, behind a password.`);

/* -------------------------------------------------------------- 5. the tunnel */

const tunnel = run(`npx --yes cloudflared tunnel --url http://localhost:${PREVIEW_PORT} --no-autoupdate`, {});
let announced = false;
const watchForUrl = (data) => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(data))?.[0];
  if (!url || announced) return;
  announced = true;
  say('');
  say('================================================================');
  say(`  Link:      ${url}`);
  say(`  User:      ${user}`);
  say(`  Password:  ${password}`);
  say('================================================================');
  say('  Send the link and the password separately. Ctrl+C closes it.');
  say('');
};
tunnel.stdout.on('data', watchForUrl);
tunnel.stderr.on('data', watchForUrl);
tunnel.on('exit', (code) => {
  say(`The tunnel stopped (exit ${code}).`);
  shutdown(code ?? 1);
});
