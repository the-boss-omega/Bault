#!/usr/bin/env node
/**
 * `pnpm tunnel`: show the running app to somebody who is not on this machine,
 * safely, in one command.
 *
 * Done by hand, each step has a way to go wrong that looks like success:
 *
 *   - tunnelling `pnpm dev` instead of the build serves the SOURCE: every
 *     `/src/**\/*.tsx` answers with the file;
 *   - a quick tunnel has no password of its own, and behind it sits an API whose
 *     seeded accounts, the administrator included, share one;
 *   - the local `.env` raises the sign-in rate limit for the test suite, so the
 *     brute-force protection a stranger would meet is effectively off;
 *   - the API refuses every write whose `Origin` it was not told about, so
 *     behind a link it does not know, sign-in included, everything is a 403.
 *
 * So this does it in the right order and refuses the unsafe shortcuts:
 *
 *   1. warns, loudly, if the sign-in rate limit is above the production default;
 *   2. builds the API and the web app, always, so the tunnel never serves a
 *      stale bundle;
 *   3. starts `vite preview` with a password in front of EVERYTHING, `/api`
 *      included, generated fresh unless `WEB_PREVIEW_PASSWORD` is set, and
 *      pointed at a free port for the API;
 *   4. starts a Cloudflare quick tunnel and reads its link;
 *   5. starts its own API on that port, with the link added to `CORS_ORIGINS`,
 *      so the link may write and nothing else new may. A `pnpm dev` API can
 *      keep running beside it: it is a separate process on its own port;
 *   6. prints the link AND the password once the API is ready.
 *
 * Ctrl+C stops all three. The link dies with them, which is also the kill switch.
 *
 * Plain Node, like `dev.mjs`: no new dependency, same behaviour on every OS.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
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

const say = (msg) => process.stdout.write(`[tunnel] ${msg}\n`);
const children = [];
const fail = (msg) => {
  process.stderr.write(`[tunnel] ${msg}\n`);
  for (const child of children) killTree(child);
  process.exit(1);
};

/** A port nothing listens on right now, for this run's API. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/* ------------------------------------------------------- 1. rate-limit check */

const authLimit = Number(env.AUTH_RATE_LIMIT_PER_MINUTE || AUTH_LIMIT_DEFAULT);
if (authLimit > AUTH_LIMIT_DEFAULT) {
  say('');
  say(`WARNING: AUTH_RATE_LIMIT_PER_MINUTE is ${authLimit} (production default ${AUTH_LIMIT_DEFAULT}).`);
  say('  The integration suite needs it high; a public link does not. A stranger who gets');
  say('  past the preview password could try that many passwords a minute. To tighten it:');
  say(`  set AUTH_RATE_LIMIT_PER_MINUTE=${AUTH_LIMIT_DEFAULT} in .env and run this again.`);
  say('');
}

/* ---------------------------------------------------------------- 2. build */

say('Building the API and the web app (always — a stale bundle is how old bugs come back)…');
const build = spawnSync(
  'pnpm --filter "./packages/*" build && pnpm --filter @bault/api build && pnpm --filter @bault/web build',
  { cwd: repoRoot, shell: true, stdio: 'inherit' },
);
if (build.status !== 0) fail('The build failed. Nothing has been exposed.');

/* ------------------------------------------------- 3. preview with a password */

const user = env.WEB_PREVIEW_USER || 'bault';
const password = env.WEB_PREVIEW_PASSWORD || randomBytes(12).toString('base64url');

// Quick-tunnel hostnames are random, so allow the whole domain for this run.
const hosts = new Set((env.WEB_PUBLIC_HOST || '').split(',').map((h) => h.trim()).filter(Boolean));
hosts.add('.trycloudflare.com');

const apiPort = await freePort();
const apiBase = `http://127.0.0.1:${apiPort}`;

/**
 * Each child in a process group of its own, so stopping it stops what its shell
 * started too: signalling only the shell leaves `cloudflared` running, and the
 * link with it.
 */
function run(command, extraEnv) {
  const child = spawn(command, {
    cwd: repoRoot,
    shell: true,
    detached: !isWindows,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return child;
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

function shutdown(code = 0) {
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => children.forEach(killTree));

const preview = run(`pnpm --filter @bault/web exec vite preview --port ${PREVIEW_PORT} --strictPort`, {
  WEB_PREVIEW_USER: user,
  WEB_PREVIEW_PASSWORD: password,
  WEB_PUBLIC_HOST: [...hosts].join(','),
  VITE_API_PROXY_TARGET: apiBase,
});
preview.stderr.on('data', (d) => process.stderr.write(d));
preview.on('exit', (code) => {
  say(`The preview server stopped (exit ${code}). Stopping the tunnel.`);
  shutdown(code ?? 1);
});

// Wait for the preview to answer with a 401, which is the point.
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

/* -------------------------------------------------------------- 4. the tunnel */

const tunnel = run(`npx --yes cloudflared tunnel --url http://localhost:${PREVIEW_PORT} --no-autoupdate`, {});
tunnel.on('exit', (code) => {
  say(`The tunnel stopped (exit ${code}).`);
  shutdown(code ?? 1);
});
const link = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(undefined), 60_000);
  const watchForUrl = (data) => {
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(data))?.[0];
    if (!url) return;
    clearTimeout(timer);
    resolve(url);
  };
  tunnel.stdout.on('data', watchForUrl);
  tunnel.stderr.on('data', watchForUrl);
});
if (!link) fail('The tunnel printed no link within 60 seconds.');

/* --------------------------------------------- 5. an API that knows the link */

// The link is the app's origin for this run. Without it in CORS_ORIGINS the API
// refuses every write from it (apps/api/src/shared/csrf/cross-site.ts).
const corsOrigins = [...(env.CORS_ORIGINS || '').split(','), link].map((o) => o.trim()).filter(Boolean);
const api = run('node apps/api/dist/main.js', { API_PORT: String(apiPort), CORS_ORIGINS: corsOrigins.join(',') });
// Warnings and errors are shown; the per-request info lines are read and
// dropped, because an unread pipe fills and then blocks the API.
api.stderr.on('data', (d) => process.stderr.write(d));
api.stdout.resume();
api.on('exit', (code) => {
  say(`The API stopped (exit ${code}). Stopping the tunnel.`);
  shutdown(code ?? 1);
});
const apiDeadline = Date.now() + 60_000;
for (;;) {
  try {
    if ((await fetch(`${apiBase}/api/v1/readyz`)).ok) break;
  } catch {
    /* not up yet */
  }
  if (Date.now() > apiDeadline) fail(`The API did not become ready on ${apiBase}. Is the database up?`);
  await new Promise((r) => setTimeout(r, 500));
}
say(`API is up at ${apiBase}, accepting writes from ${link}`);

/* ------------------------------------------------------------- 6. the link */

say('');
say('================================================================');
say(`  Link:      ${link}`);
say(`  User:      ${user}`);
say(`  Password:  ${password}`);
say('================================================================');
say('  Send the link and the password separately. Ctrl+C closes it.');
say('');
