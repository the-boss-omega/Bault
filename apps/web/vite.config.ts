import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isLoopbackHost, resolveApiProxyTarget } from './proxy-target';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, '../..');

// Vite dev server + build config for the SPA.
export default defineConfig(({ mode }) => {
  // Read the repo-root .env (where API_PORT lives) and then apps/web/.env, which
  // may override it. `''` as the prefix loads unprefixed keys too; nothing from
  // here is injected into the client bundle — it only picks the proxy target.
  const fileEnv = { ...loadEnv(mode, repoRoot, ''), ...loadEnv(mode, appDir, '') };
  const api = resolveApiProxyTarget(fileEnv);

  // Printed once at startup so the target is never a mystery when a call fails.
  // eslint-disable-next-line no-console
  console.log(`[vite] /api → ${api.target} (from ${api.source})`);

  return {
    plugins: [react()],
    // Card photos live in the repo-root assets/ folder, one file per item named by
    // its serial number. Pointing publicDir there serves them at /images/<SERIAL>.jpg
    // in dev and copies them into dist/ on build. Path is relative to this app root.
    publicDir: '../../assets',
    server: {
      port: 5173,
      // Proxy API calls to the NestJS backend during development so the browser
      // talks to one origin (avoids CORS entirely — no preflight, no CORS config
      // on the API — and matches the production reverse-proxy setup).
      //
      // Session auth needs nothing special here: the API sets its `session`
      // cookie with no Domain attribute and Path=/, so the browser scopes it to
      // localhost:5173 (the origin it actually requested) and replays it on
      // every proxied call. No cookieDomainRewrite / cookiePathRewrite required
      // — adding either would in fact break the cookie.
      proxy: {
        '/api': {
          target: api.target,
          changeOrigin: true,
          // TLS verification stays on except for a loopback https target, which
          // in local development means a self-signed certificate.
          secure: !(api.url.protocol === 'https:' && isLoopbackHost(api.url.hostname)),
          configure: (proxy) => {
            // Without this, a down backend answers the browser with an opaque
            // 500 + HTML body, which the SPA cannot tell apart from a real
            // server error. Turn it into a typed 503 the client can act on —
            // and keep logging it loudly to the terminal (it is not hidden).
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
  };
});

/** Node reports a dual-stack (IPv6 + IPv4) connect failure as an AggregateError. */
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
