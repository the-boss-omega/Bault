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
export default defineConfig(({ mode }) => {
  // Read the repo-root .env (where API_PORT lives) and then apps/web/.env, which
  // may override it. `''` as the prefix loads unprefixed keys too; nothing from
  // here is injected into the client bundle — it only picks the proxy target.
  const fileEnv = { ...loadEnv(mode, repoRoot, ''), ...loadEnv(mode, appDir, '') };
  const api = resolveApiProxyTarget(fileEnv);

  /**
   * The repo-root `.env` must not decide what KIND of bundle this is.
   *
   * `loadEnv(mode, repoRoot, '')` is called with an empty prefix because that is
   * the only way to read `API_PORT`, which has no `VITE_` on it. The side effect
   * is not obvious and was expensive: when a loaded file defines `NODE_ENV`,
   * Vite records it as `VITE_USER_NODE_ENV` and then decides `isProduction` from
   * THAT rather than from the command. The root `.env` says
   * `NODE_ENV=development`, because that is what the NestJS API and the worker
   * need — so `vite build` was quietly producing a DEVELOPMENT bundle.
   *
   * It was not a cosmetic difference. A development build keeps `jsxDEV` and the
   * file/line metadata, skips minification properly, and — the reason this was
   * found — takes every `import.meta.env.DEV` branch. `SignInPage` pre-fills the
   * form with a seeded account and the shared password under exactly such a
   * branch, so the "production" bundle shipped a working administrator-adjacent
   * credential, pre-typed into the login form, to anybody who opened it.
   *
   * The build's mode comes from the build command. `NODE_ENV` in a `.env` is a
   * message to the server processes, and this deletes it before Vite can read it
   * as an instruction. `tests/web/no-credentials-in-bundle.test.ts` checks the
   * artefact, because a guard that looks correct is what caused this.
   */
  delete process.env.VITE_USER_NODE_ENV;

  /**
   * Hosts this dev server may be reached by, beyond loopback.
   *
   * Read from the .env files first and the process environment second, so it
   * behaves like `API_PORT` — set once in `.env` and forgotten — while still
   * allowing a one-off `WEB_PUBLIC_HOST=… pnpm dev` for a temporary tunnel.
   */
  // The UNION of both sources, not the first one found. With `??`, a value in
  // `.env` silently shadowed one passed on the command line, so
  // `WEB_PUBLIC_HOST=… pnpm preview` did nothing while the file had any value.
  // Allowing a host is additive and explicit either way, so both are honoured.
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
   * A quick tunnel has no authentication of its own: the URL is the only secret,
   * and a URL is pasted into chats, screenshots and browser history. Behind it is
   * an API whose seeded accounts share one password, including an administrator.
   * `WEB_PREVIEW_PASSWORD` puts a browser sign-in prompt in front of the whole
   * site — the page, the photographs AND `/api` — so the tunnel link alone gets a
   * stranger nothing.
   *
   * Preview only. The dev server is never the thing to tunnel (it serves source),
   * and a password on it would only get in the way of the work it is for.
   */
  const previewUser = (fileEnv.WEB_PREVIEW_USER ?? process.env.WEB_PREVIEW_USER ?? 'bault').trim();
  const previewPassword = (fileEnv.WEB_PREVIEW_PASSWORD ?? process.env.WEB_PREVIEW_PASSWORD ?? '').trim();

  // Printed once at startup so the target is never a mystery when a call fails.
  // eslint-disable-next-line no-console
  console.log(`[vite] /api → ${api.target} (from ${api.source})`);

  return {
    plugins: [react(), ...(previewPassword ? [previewBasicAuth(previewUser, previewPassword)] : [])],
    // Card photos live in the repo-root assets/ folder, one file per item named by
    // its serial number. Pointing publicDir there serves them at /images/<SERIAL>.jpg
    // in dev and copies them into dist/ on build. Path is relative to this app root.
    publicDir: '../../assets',
    server: {
      port: 5173,
      /**
       * Showing the app from somewhere that is not this laptop.
       *
       * Vite refuses a request whose `Host` header it does not recognise — a
       * deliberate protection against DNS-rebinding, and the thing that makes a
       * tunnel answer "Blocked request. This host is not allowed." rather than
       * serving the app.
       *
       * `WEB_PUBLIC_HOST` opens exactly the hosts you name, comma-separated —
       * from the repo-root `.env` like every other setting here, or inline:
       *
       *   WEB_PUBLIC_HOST=192.168.1.50,demo.trycloudflare.com
       *
       * Named hosts rather than `true`, because `true` disables the check
       * altogether and the protection is worth keeping for the other 99% of the
       * time. `host: true` binds 0.0.0.0 only when a public host is named, so
       * the default stays loopback-only.
       */
      ...(publicHosts.length > 0 ? { host: true, allowedHosts: publicHosts } : {}),
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
          // Tell the API who the client really is. Without this the API saw
          // every browser as 127.0.0.1 — this proxy — and could neither rate-limit
          // per visitor nor record where a session was opened from. The API
          // trusts loopback hops only, so a forged header is ignored there.
          xfwd: true,
          // TLS verification stays on except for a loopback https target, which
          // in local development means a self-signed certificate.
          secure: !(api.url.protocol === 'https:' && isLoopbackHost(api.url.hostname)),
          configure: (proxy) => {
            // The browser resends the tunnel's basic-auth header on every request,
            // including these. The API has no use for it, and a password it never
            // needed should not be in its request logs.
            proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('authorization'));
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

    /**
     * The BUILT app, served — and the one to put a tunnel in front of.
     *
     * `WEB_PUBLIC_HOST` above opens the dev server, which was the whole point of
     * it, and for showing somebody a work in progress on the same LAN that is
     * the right tool. It is the wrong one to expose to the internet, because a
     * dev server's job is to serve modules: `GET /src/areas/.../LandingPage.tsx`
     * answers 200 with the transpiled file, doc comments and all. Anybody with
     * the tunnel link can read the source by guessing paths.
     *
     * `vite preview` serves `dist/` and nothing else. There are no `.tsx` files
     * and no sourcemaps in there, and the comments are stripped by the minifier,
     * so the same request answers with `index.html` via the SPA fallback.
     *
     * Two settings it does NOT inherit from `server` above, which is why this
     * block exists rather than being assumed:
     *
     *   - `allowedHosts`. Vite checks `preview.allowedHosts` separately, so
     *     without this a tunnel gets "Blocked request. This host is not
     *     allowed." from the safe server while the unsafe one lets it through —
     *     precisely the wrong way round.
     *   - `host`, for the same reason: bound to loopback unless a public host
     *     is named.
     *
     * `proxy` IS inherited, so `/api` reaches the API on one origin here exactly
     * as it does in development, and the session cookie needs no special
     * handling for the same reason it does not there.
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
 * Registered directly in `configurePreviewServer` rather than in its returned
 * callback, which is what makes it run BEFORE Vite's own middlewares — the
 * static files and the `/api` proxy alike. A check that ran after the proxy
 * would guard the page and leave the API open behind it.
 *
 * The comparison is on equal-length buffers with `timingSafeEqual`. A string
 * `===` returns as soon as a character differs, which tells a patient caller how
 * much of the password they have right.
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
