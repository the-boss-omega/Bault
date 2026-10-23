#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const PREVIEW_PORT = 4173;
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

const authLimit = Number(env.AUTH_RATE_LIMIT_PER_MINUTE || AUTH_LIMIT_DEFAULT);
if (authLimit > AUTH_LIMIT_DEFAULT) {
  say('');
  say(`WARNING: AUTH_RATE_LIMIT_PER_MINUTE is ${authLimit} (production default ${AUTH_LIMIT_DEFAULT}).`);
  say('  The integration suite needs it high; a public link does not. A stranger who gets');
  say('  past the preview password could try that many passwords a minute. To tighten it:');
  say(`  set AUTH_RATE_LIMIT_PER_MINUTE=${AUTH_LIMIT_DEFAULT} in .env and run this again.`);
  say('');
}

say('Building the API and the web app (always — a stale bundle is how old bugs come back)…');
const build = spawnSync(
  'pnpm --filter "./packages/*" build && pnpm --filter @bault/api build && pnpm --filter @bault/web build',
  { cwd: repoRoot, shell: true, stdio: 'inherit' },
);
if (build.status !== 0) fail('The build failed. Nothing has been exposed.');

const user = env.WEB_PREVIEW_USER || 'bault';
const password = env.WEB_PREVIEW_PASSWORD || randomBytes(12).toString('base64url');

const hosts = new Set((env.WEB_PUBLIC_HOST || '').split(',').map((h) => h.trim()).filter(Boolean));
hosts.add('.trycloudflare.com');

const apiPort = await freePort();
const apiBase = `http://127.0.0.1:${apiPort}`;

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

const deadline = Date.now() + 30_000;
for (;;) {
  try {
    const res = await fetch(`http://127.0.0.1:${PREVIEW_PORT}/`);
    if (res.status === 401) break;
    if (res.ok) fail('The preview answered WITHOUT asking for a password. Refusing to open a tunnel to it.');
  } catch {
  }
  if (Date.now() > deadline) fail(`The preview did not start on port ${PREVIEW_PORT}. Is it already in use?`);
  await new Promise((r) => setTimeout(r, 500));
}
say(`Preview is serving the build on ${PREVIEW_PORT}, behind a password.`);

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

const corsOrigins = [...(env.CORS_ORIGINS || '').split(','), link].map((o) => o.trim()).filter(Boolean);
const api = run('node apps/api/dist/main.js', { API_PORT: String(apiPort), CORS_ORIGINS: corsOrigins.join(',') });
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
  }
  if (Date.now() > apiDeadline) fail(`The API did not become ready on ${apiBase}. Is the database up?`);
  await new Promise((r) => setTimeout(r, 500));
}
say(`API is up at ${apiBase}, accepting writes from ${link}`);

say('');
say('================================================================');
say(`  Link:      ${link}`);
say(`  User:      ${user}`);
say(`  Password:  ${password}`);
say('================================================================');
say('  Send the link and the password separately. Ctrl+C closes it.');
say('');
