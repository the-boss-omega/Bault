import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isLoopbackHost, resolveApiProxyTarget } from './proxy-target';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, '../..');

export default defineConfig(({ mode, command }) => {
  const fileEnv = { ...loadEnv(mode, repoRoot, ''), ...loadEnv(mode, appDir, '') };
  const api = resolveApiProxyTarget(fileEnv);

  delete process.env.VITE_USER_NODE_ENV;
  if (command === 'build') {
    const asked = nodeEnvInEnvFiles(appDir, mode);
    if (asked?.value === 'development') {
      throw new Error(
        `apps/web/${asked.file} sets NODE_ENV=development, which would make this build a ` +
          'development bundle (pre-filled seeded credentials included). Remove that line: ' +
          'the dev server needs no NODE_ENV, and a build is always production.',
      );
    }
    process.env.NODE_ENV = 'production';
  }

  const publicHosts = [
    ...new Set(
      [fileEnv.WEB_PUBLIC_HOST, process.env.WEB_PUBLIC_HOST]
        .flatMap((v) => (v ?? '').split(','))
        .map((h) => h.trim())
        .filter(Boolean),
    ),
  ];

  const previewUser = (fileEnv.WEB_PREVIEW_USER ?? process.env.WEB_PREVIEW_USER ?? 'bault').trim();
  const previewPassword = (fileEnv.WEB_PREVIEW_PASSWORD ?? process.env.WEB_PREVIEW_PASSWORD ?? '').trim();

  // eslint-disable-next-line no-console
  console.log(`[vite] /api → ${api.target} (from ${api.source})`);

  return {
    plugins: [react(), ...(previewPassword ? [previewBasicAuth(previewUser, previewPassword)] : [])],
    publicDir: '../../assets',
    server: {
      port: 5173,
      ...(publicHosts.length > 0 ? { host: true, allowedHosts: publicHosts } : {}),
      proxy: {
        '/api': {
          target: api.target,
          changeOrigin: true,
          xfwd: true,
          secure: !(api.url.protocol === 'https:' && isLoopbackHost(api.url.hostname)),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('authorization'));
            proxy.on('error', (err, req, res) => {
              const codes = collectErrorCodes(err);
              const refused = codes.includes('ECONNREFUSED');
              // eslint-disable-next-line no-console
              console.error(
                refused
                  ? `[vite] API unreachable at ${api.target} — is it running? Try \`pnpm dev:api\` (or \`pnpm dev\` for both). Request: ${req.url}`
                  : `[vite] proxy error for ${req.url} → ${api.target}: ${err.message}`,
              );
              const response = res as ServerResponse;
              if (typeof response?.writeHead !== 'function' || response.headersSent) return;
              response.writeHead(503, { 'Content-Type': 'application/json' });
              response.end(
                JSON.stringify({
                  error: {
                    code: 'api_unreachable',
                    message: `The Bault API is unavailable at ${api.target}.`,
                    details: { target: api.target, codes },
                  },
                }),
              );
            });
          },
        },
      },
    },

    preview: {
      port: 4173,
      ...(publicHosts.length > 0 ? { host: true, allowedHosts: publicHosts } : {}),
    },
  };
});

function nodeEnvInEnvFiles(dir: string, mode: string): { value: string; file: string } | undefined {
  let found: { value: string; file: string } | undefined;
  for (const file of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?NODE_ENV\s*(?:=|:\s)\s*(.*)$/.exec(line);
      if (!m) continue;
      const raw = m[1]!.trim();
      const quoted = /^(['"`])(.*?)\1/.exec(raw);
      found = { value: quoted ? quoted[2]! : raw.replace(/\s+#.*$/, ''), file };
    }
  }
  return found;
}

function collectErrorCodes(err: Error): string[] {
  const codes: string[] = [];
  const direct = (err as NodeJS.ErrnoException).code;
  if (direct) codes.push(direct);
  const nested = (err as AggregateError).errors;
  if (Array.isArray(nested)) {
    for (const inner of nested) {
      const code = (inner as NodeJS.ErrnoException)?.code;
      if (code && !codes.includes(code)) codes.push(code);
    }
  }
  return codes;
}

function previewBasicAuth(user: string, password: string): Plugin {
  const expected = Buffer.from(`${user}:${password}`);
  return {
    name: 'bault-preview-basic-auth',
    configurePreviewServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const header = req.headers.authorization ?? '';
        const given = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64') : Buffer.alloc(0);
        if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Bault preview", charset="UTF-8"');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Sign in to view this preview.');
      });
    },
  };
}
