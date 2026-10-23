export const DEFAULT_API_PORT = 3000;

export const DEFAULT_API_HOST = '127.0.0.1';

export type ApiProxyTargetSource = 'VITE_API_PROXY_TARGET' | 'API_PORT' | 'default';

export interface ApiProxyTarget {
  target: string;
  source: ApiProxyTargetSource;
  url: URL;
}

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
