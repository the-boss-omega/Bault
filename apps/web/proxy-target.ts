/**
 * Resolves the address the Vite dev server forwards `/api/*` to.
 *
 * Kept in its own module (instead of inline in vite.config.ts) so the resolution
 * rules are unit-testable — a wrong proxy target is exactly the kind of silent
 * misconfiguration that only shows up as an ECONNREFUSED in the browser.
 *
 * Precedence, highest first:
 *   1. VITE_API_PROXY_TARGET — explicit full URL, e.g. http://127.0.0.1:3000
 *   2. API_PORT              — the port the Nest API actually binds (root .env)
 *   3. the built-in default  — http://127.0.0.1:3000
 *
 * `127.0.0.1` rather than `localhost` on purpose: on Windows `localhost`
 * resolves to BOTH ::1 and 127.0.0.1, so Node tries each in turn and a refused
 * connection surfaces as an opaque `AggregateError [ECONNREFUSED]` naming
 * neither address. Pinning IPv4 makes the failure (and the fix) unambiguous.
 *
 * This affects the DEV SERVER ONLY. Production builds emit same-origin `/api/v1`
 * requests that the reverse proxy in front of the SPA routes to the API.
 */

/** Port the API binds when API_PORT is unset — mirrors the default in @bault/config. */
export const DEFAULT_API_PORT = 3000;

/** Loopback host used for the built-in default target (IPv4, see module doc). */
export const DEFAULT_API_HOST = '127.0.0.1';

export type ApiProxyTargetSource = 'VITE_API_PROXY_TARGET' | 'API_PORT' | 'default';

export interface ApiProxyTarget {
  /** Absolute origin, e.g. `http://127.0.0.1:3000`. */
  target: string;
  /** Which input produced it — surfaced in the dev-server banner. */
  source: ApiProxyTargetSource;
  /** Parsed form, so callers can branch on protocol/hostname without re-parsing. */
  url: URL;
}

/** Loopback addresses may skip TLS verification (self-signed local certs). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function fail(message: string): never {
  throw new Error(
    `Invalid API proxy configuration: ${message}\n` +
      `Set VITE_API_PROXY_TARGET to the API origin, e.g. VITE_API_PROXY_TARGET=http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`,
  );
}

/**
 * Resolve (and validate) the dev proxy target. Throws a readable error rather
 * than silently proxying somewhere wrong — a bad value must fail at startup.
 */
export function resolveApiProxyTarget(env: Record<string, string | undefined> = {}): ApiProxyTarget {
  const explicit = env.VITE_API_PROXY_TARGET?.trim();

  if (explicit) {
    let url: URL;
    try {
      url = new URL(explicit);
    } catch {
      fail(`VITE_API_PROXY_TARGET is not a valid URL (received "${explicit}").`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      fail(`VITE_API_PROXY_TARGET must be an http(s) URL (received "${explicit}").`);
    }
    // Strip any path/query: the proxy appends the request path itself.
    return { target: url.origin, source: 'VITE_API_PROXY_TARGET', url: new URL(url.origin) };
  }

  const rawPort = env.API_PORT?.trim();
  if (rawPort) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      fail(`API_PORT is not a valid TCP port (received "${rawPort}").`);
    }
    const url = new URL(`http://${DEFAULT_API_HOST}:${port}`);
    return { target: url.origin, source: 'API_PORT', url };
  }

  const url = new URL(`http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`);
  return { target: url.origin, source: 'default', url };
}
