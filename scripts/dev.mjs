#!/usr/bin/env node
/**
 * `pnpm dev` — starts the whole local stack in the right order.
 *
 * WHY this exists: the SPA asks `GET /api/v1/me/profile` on its very first
 * paint. Starting only the web app (`pnpm dev:web`) therefore produced an
 * immediate `http proxy error: /api/v1/me/profile AggregateError [ECONNREFUSED]`
 * — the frontend was talking to a backend nobody had started. The two processes
 * are ordered here instead of relying on the developer to remember:
 *
 *   1. start the API (`nest start --watch`)
 *   2. poll its PUBLIC health endpoint until it answers
 *   3. only then start Vite (which inherits the same, explicit proxy target)
 *   4. if the API never becomes ready, fail loudly with what to check
 *
 * Plain Node on purpose: no `concurrently` / `wait-on` / `cross-env` dependency
 * to add, and it behaves identically on Windows, macOS and Linux.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const READY_TIMEOUT_MS = Number(process.env.DEV_API_READY_TIMEOUT_MS ?? 120_000);
const POLL_INTERVAL_MS = 500;

/**
 * Minimal `.env` reader — only used to discover API_PORT. Values already in the
 * real environment win, matching the precedence in apps/web/proxy-target.ts.
 */
function readEnvFile(path) {
  try {
    const out = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = readEnvFile(join(repoRoot, '.env'));
const env = { ...fileEnv, ...process.env };

// Same rules as the Vite proxy: explicit target wins, else API_PORT, else 3000.
// 127.0.0.1 (not localhost) so a failure names one address instead of an
// AggregateError over ::1 + 127.0.0.1.
const apiTarget = (env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${env.API_PORT || 3000}`).replace(
  /\/+$/,
  '',
);
const healthUrl = `${apiTarget}/api/v1/healthz`;
/** The port the API will try to bind, for the in-use check below. */
const apiPort = Number(new URL(apiTarget).port || 3000);

const children = [];
let shuttingDown = false;
let apiExited = false;

/**
 * `command` is a single string (not argv) because `shell: true` with an argv
 * array is deprecated in Node 22. Every argument here is a project constant —
 * nothing from user input is interpolated.
 */
function run(name, command, options = {}) {
  const child = spawn(command, {
    cwd: repoRoot,
    shell: true, // resolves pnpm.cmd on Windows
    env: { ...process.env, VITE_API_PROXY_TARGET: apiTarget },
    ...options,
  });
  child.on('error', (err) => {
    console.error(`[dev] failed to start ${name}: ${err.message}`);
    shutdown(1);
  });
  children.push({ name, child });
  return child;
}

/** Prefix a child's output so interleaved API/web logs stay readable. */
function prefix(stream, tag, sink) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) sink.write(`${tag} ${line}\n`);
  });
  stream.on('end', () => {
    if (buffer) sink.write(`${tag} ${buffer}\n`);
  });
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (isWindows) {
    // A shell-spawned pnpm on Windows is a tree; SIGTERM on the parent alone
    // would orphan node/nest. /T kills the tree, /F forces it.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) killTree(child);
  process.exitCode = code;
  // Give taskkill a moment before the parent disappears.
  setTimeout(() => process.exit(code), 300).unref();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(0));
}

/**
 * Wait for the API's liveness endpoint. `/healthz` is public and dependency-free
 * — deliberately NOT `/me/profile`, which requires a session and would answer
 * 401 forever even on a perfectly healthy server.
 */
async function waitForApi() {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (apiExited) return false;
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return true;
    } catch {
      /* not listening yet — keep polling */
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.error(
    `[dev] the API did not answer ${healthUrl} within ${Math.round(READY_TIMEOUT_MS / 1000)}s.\n` +
      '[dev] check: is PostgreSQL up (docker compose -f infra/docker-compose.yml up -d)?\n' +
      '[dev] check: does the root .env exist with DATABASE_URL and API_PORT?',
  );
  return false;
}

/**
 * Is something already sitting on the API's port?
 *
 * Without this the failure is a raw Node stack trace — `EADDRINUSE` followed by
 * twelve frames of Nest internals — which says what happened but nothing about
 * what to do, and buries the one useful word under a wall of paths. The usual
 * cause is the most boring one: an earlier `pnpm dev` that was closed by
 * shutting a terminal rather than with Ctrl-C, so its child API is still
 * running and still holding the port.
 *
 * Checked BEFORE spawning anything, so the script fails in a sentence instead
 * of starting the API, watching it die, and then reporting that the API died.
 */
async function portIsBusy() {
  try {
    // A liveness probe is the cheapest possible check, and it distinguishes the
    // two cases that matter: a stale Bault API (answers /healthz) from some
    // unrelated process that merely holds the port (does not).
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) });
    return res.ok ? 'bault' : 'other';
  } catch {
    // Either nothing is listening, or something is listening and is not us.
    // Distinguished by attempting a bare connection.
    return await new Promise((resolve) => {
      const socket = net.connect({ port: apiPort, host: '127.0.0.1' });
      socket.setTimeout(1_000);
      socket.on('connect', () => {
        socket.destroy();
        resolve('other');
      });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }
}

const busy = await portIsBusy();
if (busy) {
  const who =
    busy === 'bault'
      ? 'Another Bault API is already running there — probably a `pnpm dev` whose terminal was closed instead of stopped with Ctrl-C.'
      : 'Something else is listening on that port.';
  console.error(
    `[dev] port ${apiPort} is already in use. ${who}\n` +
      '[dev] free it, then run `pnpm dev` again:\n' +
      (process.platform === 'win32'
        ? `[dev]   powershell -Command "Get-NetTCPConnection -LocalPort ${apiPort} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"\n`
        : `[dev]   lsof -ti :${apiPort} | xargs kill\n`) +
      `[dev] or run on a different port with API_PORT=<port> in the root .env.`,
  );
  process.exit(1);
}

console.log(`[dev] API target: ${apiTarget}  (health: ${healthUrl})`);
console.log('[dev] starting the API…');

const apiChild = run('api', 'pnpm --filter @bault/api dev', { stdio: ['ignore', 'pipe', 'pipe'] });
prefix(apiChild.stdout, '[api]', process.stdout);
prefix(apiChild.stderr, '[api]', process.stderr);

// The API dying is always fatal here: `nest start --watch` recovers from a
// compile error on its own, so an actual exit means the process is gone and the
// web app would be left proxying to a closed port — the exact failure this
// script exists to prevent.
apiChild.on('exit', (code) => {
  apiExited = true;
  if (shuttingDown) return;
  console.error(`[dev] the API exited (code ${code}). Stopping the web app too — see [api] output above.`);
  shutdown(1);
});

const ready = await waitForApi();
if (!ready) {
  console.error('[dev] not starting the web app — it would only proxy to a dead API.');
  shutdown(1);
} else {
  console.log('[dev] API is ready — starting the web app…');
  // Inherited stdio keeps Vite's colours, URL banner and keyboard shortcuts.
  const webChild = run('web', 'pnpm --filter @bault/web dev', { stdio: 'inherit' });
  webChild.on('exit', (code) => shutdown(code ?? 0));
}
