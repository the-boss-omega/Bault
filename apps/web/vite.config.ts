import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isLoopbackHost, resolveApiProxyTarget } from './proxy-target';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, '../..');

// Vite dev server + build config for the SPA.
export default defineConfig(({ mode, command }) => {
  // Read the repo-root .env (where API_PORT lives), then apps/web/.env, which
  // may override it. The empty prefix loads unprefixed keys too. Nothing from
  // here reaches the client bundle; it only picks the proxy target.
  const fileEnv = { ...loadEnv(mode, repoRoot, ''), ...loadEnv(mode, appDir, '') };
  const api = resolveApiProxyTarget(fileEnv);

  /**
   * A build is always a production build, whatever `NODE_ENV` says.
   *
   * The empty-prefix `loadEnv` above also loads `NODE_ENV` from the root `.env`
   * (`development`, for the API and worker); Vite records it as
   * `VITE_USER_NODE_ENV` and decides `isProduction` from it. Vite also obeys
   * `NODE_ENV` in the shell, and CI sets `NODE_ENV=test`. Either would make
   * `vite build` emit a development bundle that takes the `import.meta.env.DEV`
   * branches, including `SignInPage`'s pre-filled seeded credentials. Vite reads
   * `NODE_ENV` after this config runs, so it is set here.
   * `tests/web/no-credentials-in-bundle.test.ts` checks the built artefact.
   */
  delete process.env.VITE_USER_NODE_ENV;
  if (command === 'build') process.env.NODE_ENV = 'production';

  /**
   * Hosts this server may be reached by, beyond loopback: the union of
   * `WEB_PUBLIC_HOST` from the .env files and from the process environment, so a
   * one-off `WEB_PUBLIC_HOST=… pnpm preview` works even when `.env` sets one.
   */
  const publicHosts = [
    ...new Set(
      [fileEnv.WEB_PUBLIC_HOST, process.env.WEB_PUBLIC_HOST]
        .flatMap((v) => (v ?? '').split(','))
        .map((h) => h.trim())
        .filter(Boolean),
    ),
  ];

  /**
   * A password in front of the built app, for when it is on a public tunnel.
   *
   * A quick tunnel has no authentication of its own, and behind it is an API
   * whose seeded accounts share one password, including an administrator.
   * `WEB_PREVIEW_PASSWORD` puts a browser sign-in prompt in front of the whole
   * site: the page, the photographs and `/api`. Preview only; the dev server
   * serves source and is never the thing to tunnel.
   */
  const previewUser = (fileEnv.WEB_PREVIEW_USER ?? process.env.WEB_PREVIEW_USER ?? 'bault').trim();
  const previewPassword = (fileEnv.WEB_PREVIEW_PASSWORD ?? process.env.WEB_PREVIEW_PASSWORD ?? '').trim();

  // Printed once at startup so the target is never a mystery when a call fails.
  // eslint-disable-next-line no-console
  console.log(`[vite] /api → ${api.target} (from ${api.source})`);

  return {
    plugins: [react(), ...(previewPassword ? [previewBasicAuth(previewUser, previewPassword)] : [])],
    // Card photos and fonts live in the repo-root assets/ folder. Pointing
    // publicDir there serves photos at /images/<SERIAL>.<ext> in dev and copies
    // them into dist/ on build. The path is relative to this app root.
    publicDir: '../../assets',
    server: {
      port: 5173,
      /**
       * Vite refuses a request whose `Host` it does not recognise, as protection
       * against DNS rebinding. `WEB_PUBLIC_HOST` opens exactly the hosts named,
       * comma-separated (`192.168.1.50,demo.trycloudflare.com`), which keeps the
       * check on for everything else. `host: true` binds 0.0.0.0 only when a
       * public host is named, so the default stays loopback-only.
       */
      ...(publicHosts.length > 0 ? { host: true, allowedHosts: publicHosts } : {}),
      // The browser talks to one origin, as behind the production reverse proxy,
      // so the API needs no CORS. The API's `session` cookie has no Domain and
      // Path=/, so the browser scopes it to this origin and replays it on every
      // proxied call; a cookieDomainRewrite or cookiePathRewrite would break it.
      proxy: {
        '/api': {
          target: api.target,
          changeOrigin: true,
          // Forward the client address so the API can rate-limit per visitor and
          // record where a session was opened from. The API trusts loopback hops
          // only, so a forged header is ignored there.
          xfwd: true,
          // TLS verification stays on except for a loopback https target, which
          // in local development means a self-signed certificate.
          secure: !(api.url.protocol === 'https:' && isLoopbackHost(api.url.hostname)),
          configure: (proxy) => {
            // The browser resends the tunnel's basic-auth header on every request,
            // including these. The API has no use for it, and a password it never
            // needed should not be in its request logs.
            proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('authorization'));
            // A down backend would otherwise reach the browser as an opaque 500
            // with an HTML body, indistinguishable from a real server error.
            // Answer with a typed 503 the SPA can act on, and log it here.
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

    /**
     * The built app, served: the one to put a tunnel in front of. The dev server
     * serves source modules (`GET /src/...tsx` answers with the transpiled file);
     * `vite preview` serves only `dist/`.
     *
     * Preview does not inherit `allowedHosts` or `host` from `server`, so both are
     * set here. It does inherit `proxy`, so `/api` stays on the same origin.
     */
    preview: {
      port: 4173,
      ...(publicHosts.length > 0 ? { host: true, allowedHosts: publicHosts } : {}),
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

/**
 * HTTP basic auth for `vite preview`, compared in constant time.
 *
 * It is registered directly in `configurePreviewServer`, outside the returned
 * callback, so it runs before Vite's own middlewares: the static files and the
 * `/api` proxy alike. A check after the proxy would leave the API open.
 */
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
