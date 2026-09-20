import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
    plugins: [react(), ...(previewPassword ? [previewGate(previewUser, previewPassword)] : [])],
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
            //
            // Same for the gate's own cookie: it proves the viewer typed the
            // preview password, which is nothing the API should see or keep.
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('authorization');
              const cookie = proxyReq.getHeader('cookie');
              if (typeof cookie !== 'string') return;
              const rest = cookie
                .split(/;\s*/)
                .filter((c) => c && !c.startsWith(`${PREVIEW_COOKIE}=`))
                .join('; ');
              if (rest) proxyReq.setHeader('cookie', rest);
              else proxyReq.removeHeader('cookie');
            });
            // Without this, a down backend answers the browser with an opaque
            // 500 + HTML body, which the SPA cannot tell apart from a real
            // server error. Turn it into a typed 503 the client can act on —
            // and keep logging it loudly to the terminal (it is not hidden).
            /**
             * A reset mid-response must not take the server down with it.
             *
             * `proxy.on('error')` below covers a request that fails before the
             * reply starts. It does not cover a reply already in flight: the
             * error is emitted on the TARGET's response stream, and an
             * `error` event with no listener is an uncaught exception, which
             * ends the process. Nothing noticed while every API reply was a
             * small JSON body that completed in one tick — then `/media/object`
             * began STREAMING photographs, and a viewer who scrolled away
             * mid-image (or a tab that closed) reset the connection and killed
             * the preview server, taking the tunnel with it.
             *
             * So: listen on both halves and hang up quietly. A viewer who has
             * gone is not an error anybody needs to see.
             */
            proxy.on('proxyRes', (proxyRes, _req, res) => {
              proxyRes.on('error', () => (res as ServerResponse).destroy());
              res.on('close', () => proxyRes.destroy());
            });

            proxy.on('error', (err, req, res) => {
              const codes = collectErrorCodes(err);
              const refused = codes.includes('ECONNREFUSED');
              // The viewer closed the tab or scrolled away mid-download. There is
              // nobody left to answer and nothing to report.
              if (codes.includes('ECONNRESET') || codes.includes('EPIPE')) {
                (res as ServerResponse)?.destroy?.();
                return;
              }
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

/** The cookie the preview gate sets once the password has been typed. */
const PREVIEW_COOKIE = 'bault_preview';
/** Where the gate's own form posts. Not a route the SPA or the API owns. */
const PREVIEW_SIGN_IN = '/__preview/sign-in';

/**
 * The password in front of `vite preview`, as a PAGE rather than a browser prompt.
 *
 * It began as HTTP basic auth, which leans on the browser to draw its own
 * sign-in box. Most do — but the built-in browsers of WhatsApp, Telegram,
 * Instagram and Facebook often do not, and a link sent in a chat opens in
 * exactly those. The viewer got a blank page reading "Sign in to view this
 * preview." with nowhere to type anything: they could not reach Bault at all,
 * and nothing was logged, because nothing reached it.
 *
 * So a browser now gets an ordinary form, served by this gate before anything
 * else. The right password sets an HttpOnly cookie and redirects back to where
 * the viewer was going; every later request (the page, the photographs, `/api`)
 * carries the cookie. Basic auth is still accepted, so `curl -u` and scripts work
 * as before, and anything that is not a page gets a plain 401.
 *
 * Registered directly in `configurePreviewServer` rather than in its returned
 * callback, which makes it run BEFORE Vite's own middlewares — the static files
 * and the `/api` proxy alike. A check that ran after the proxy would guard the
 * page and leave the API open behind it.
 *
 *   - Comparisons are on equal-length buffers with `timingSafeEqual`; a string
 *     `===` returns at the first differing character.
 *   - The cookie is an HMAC under a key made fresh at every start, never the
 *     password: restarting the preview signs everybody out, and the cookie is
 *     worthless anywhere else.
 *   - Ten wrong passwords from one address in fifteen minutes and the form stops
 *     answering for that address until the window passes. The password is long
 *     and random; this is so that guessing it is also slow.
 */
function previewGate(user: string, password: string): Plugin {
  const expectedBasic = Buffer.from(`${user}:${password}`);
  const expectedPassword = Buffer.from(password);
  const token = Buffer.from(createHmac('sha256', randomBytes(32)).update(`${user}:${password}`).digest('hex'));
  const failures = new Map<string, { count: number; since: number }>();
  const WINDOW_MS = 15 * 60_000;
  const MAX_FAILURES = 10;

  const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
  const clientOf = (req: IncomingMessage) =>
    String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? 'unknown');
  const cookieOf = (req: IncomingMessage) => {
    const m = new RegExp(`(?:^|;\\s*)${PREVIEW_COOKIE}=([a-f0-9]+)`).exec(req.headers.cookie ?? '');
    return m ? Buffer.from(m[1]!) : Buffer.alloc(0);
  };
  const basicOf = (req: IncomingMessage) => {
    const header = req.headers.authorization ?? '';
    return header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64') : Buffer.alloc(0);
  };
  /** Only a same-site path, so the form cannot be used to bounce somebody elsewhere. */
  const safeNext = (raw: string | null) => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/');
  const isHttps = (req: IncomingMessage) =>
    String(req.headers['x-forwarded-proto'] ?? '').includes('https') ||
    String(req.headers['cf-visitor'] ?? '').includes('https');

  const sendPage = (res: ServerResponse, status: number, next: string, message: 'wrong' | 'locked' | null) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.end(gatePage(next, message));
  };

  return {
    name: 'bault-preview-gate',
    configurePreviewServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', 'http://preview.local');

        if (url.pathname === PREVIEW_SIGN_IN && req.method === 'POST') {
          const who = clientOf(req);
          const now = Date.now();
          const record = failures.get(who);
          if (record && now - record.since > WINDOW_MS) failures.delete(who);
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', () => {
            const form = new URLSearchParams(body);
            const target = safeNext(form.get('next'));
            const current = failures.get(who);
            if (current && current.count >= MAX_FAILURES) return sendPage(res, 429, target, 'locked');
            if (same(Buffer.from(form.get('password') ?? ''), expectedPassword)) {
              failures.delete(who);
              res.statusCode = 303;
              res.setHeader(
                'Set-Cookie',
                `${PREVIEW_COOKIE}=${token.toString()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${isHttps(req) ? '; Secure' : ''}`,
              );
              res.setHeader('Location', target);
              res.setHeader('Cache-Control', 'no-store');
              return res.end();
            }
            failures.set(who, { count: (current?.count ?? 0) + 1, since: current?.since ?? now });
            return sendPage(res, 401, target, 'wrong');
          });
          return;
        }

        if (same(cookieOf(req), token) || same(basicOf(req), expectedBasic)) return next();

        // A page gets the form. Anything else — a script, an API call, curl —
        // gets a plain 401, with the basic-auth challenge so a CLI still works.
        const wantsPage = req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html');
        if (wantsPage) return sendPage(res, 401, url.pathname + url.search, null);
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Bault preview", charset="UTF-8"');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Sign in to view this preview.');
      });
    },
  };
}

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The gate's page: self-contained (no script, no external file), both
 * languages, and nothing about Bault beyond its name — somebody without the
 * password learns only that there is a password.
 */
function gatePage(next: string, message: 'wrong' | 'locked' | null): string {
  const notice =
    message === 'wrong'
      ? '<p class="err" role="alert">That password is not right. · הסיסמה לא נכונה.</p>'
      : message === 'locked'
        ? '<p class="err" role="alert">Too many attempts. Try again in 15 minutes. · יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.</p>'
        : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Bault — preview</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    background: #16171b; color: #f3f4f2; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main, form { display: grid; gap: 16px; }
  main { inline-size: min(100%, 360px); }
  .mark { inline-size: 40px; block-size: 40px; display: grid; place-items: center; background: #f3f4f2;
    color: #16171b; font: 600 22px/1 Georgia, serif; border-radius: 3px; }
  h1 { margin: 0; font: 500 24px/1.25 Georgia, serif; }
  p { margin: 0; color: rgba(243,244,242,.72); }
  .he { direction: rtl; }
  label { display: grid; gap: 8px; font-size: 14px; color: rgba(243,244,242,.72); }
  input { font: inherit; padding: 12px; border-radius: 3px; border: 1px solid rgba(243,244,242,.3);
    background: #0f1013; color: inherit; }
  input:focus { outline: 2px solid #4fbfa2; outline-offset: 2px; }
  button { font: 600 16px/1 system-ui, sans-serif; padding: 14px; border: 0; border-radius: 3px;
    background: #0f5e4b; color: #fff; cursor: pointer; }
  .err { color: #f0a3a3; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">B</div>
  <h1>This preview is private</h1>
  <p>Enter the preview password you were sent. Your Bault account comes after this.</p>
  <p class="he">זו תצוגה פרטית. הזינו את סיסמת התצוגה שקיבלתם — חשבון Bault מגיע אחרי זה.</p>
  ${notice}
  <form method="post" action="${PREVIEW_SIGN_IN}">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <label>Preview password · סיסמת תצוגה
      <input type="password" name="password" autocomplete="current-password" autofocus required>
    </label>
    <button type="submit">Continue · המשך</button>
  </form>
</main>
</body>
</html>`;
}
