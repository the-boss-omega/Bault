#!/usr/bin/env node
import { spawn } from 'node:child_process';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const READY_TIMEOUT_MS = Number(process.env.DEV_API_READY_TIMEOUT_MS ?? 120_000);
const POLL_INTERVAL_MS = 500;

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

const apiTarget = (env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${env.API_PORT || 3000}`).replace(
  /\/+$/,
  '',
);
const healthUrl = `${apiTarget}/api/v1/healthz`;
const apiPort = Number(new URL(apiTarget).port || 3000);

const children = [];
let shuttingDown = false;
let apiExited = false;

function run(name, command, options = {}) {
  const child = spawn(command, {
    cwd: repoRoot,
    shell: true,
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
  setTimeout(() => process.exit(code), 300).unref();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => shutdown(0));
}

async function waitForApi() {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (apiExited) return false;
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return true;
    } catch {
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

async function portIsBusy() {
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) });
    return res.ok ? 'bault' : 'other';
  } catch {
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
  const webChild = run('web', 'pnpm --filter @bault/web dev', { stdio: 'inherit' });
  webChild.on('exit', (code) => shutdown(code ?? 0));
}
