import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  isLoopbackHost,
  resolveApiProxyTarget,
} from '../../apps/web/proxy-target';

/**
 * Guards the configuration that produced the original
 * `http proxy error: /api/v1/me/profile AggregateError [ECONNREFUSED]`:
 * the dev server must forward /api to the address the API actually binds, and
 * must refuse to start rather than proxy somewhere wrong.
 */
describe('resolveApiProxyTarget', () => {
  it('defaults to the API loopback address on the documented port', () => {
    const resolved = resolveApiProxyTarget({});
    expect(resolved.target).toBe(`http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`);
    expect(resolved.source).toBe('default');
  });

  it('never defaults to localhost (which resolves to both ::1 and 127.0.0.1)', () => {
    expect(resolveApiProxyTarget({}).url.hostname).toBe('127.0.0.1');
  });

  it('follows API_PORT from the repo-root .env', () => {
    const resolved = resolveApiProxyTarget({ API_PORT: '4001' });
    expect(resolved.target).toBe('http://127.0.0.1:4001');
    expect(resolved.source).toBe('API_PORT');
  });

  it('lets VITE_API_PROXY_TARGET win over API_PORT', () => {
    const resolved = resolveApiProxyTarget({
      API_PORT: '3000',
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:8080',
    });
    expect(resolved.target).toBe('http://127.0.0.1:8080');
    expect(resolved.source).toBe('VITE_API_PROXY_TARGET');
  });

  it('strips a trailing path so the proxy appends the request path itself', () => {
    expect(resolveApiProxyTarget({ VITE_API_PROXY_TARGET: 'http://127.0.0.1:3000/api/v1' }).target).toBe(
      'http://127.0.0.1:3000',
    );
  });

  it('ignores an empty or whitespace-only override', () => {
    expect(resolveApiProxyTarget({ VITE_API_PROXY_TARGET: '   ', API_PORT: '3000' }).source).toBe(
      'API_PORT',
    );
  });

  it('fails loudly on a malformed target instead of proxying nowhere', () => {
    expect(() => resolveApiProxyTarget({ VITE_API_PROXY_TARGET: 'not a url' })).toThrow(
      /VITE_API_PROXY_TARGET is not a valid URL/,
    );
    expect(() => resolveApiProxyTarget({ VITE_API_PROXY_TARGET: 'ftp://127.0.0.1:3000' })).toThrow(
      /must be an http\(s\) URL/,
    );
  });

  it('fails loudly on an impossible API_PORT', () => {
    expect(() => resolveApiProxyTarget({ API_PORT: '0' })).toThrow(/not a valid TCP port/);
    expect(() => resolveApiProxyTarget({ API_PORT: '99999' })).toThrow(/not a valid TCP port/);
    expect(() => resolveApiProxyTarget({ API_PORT: 'three thousand' })).toThrow(/not a valid TCP port/);
  });

  it('names the variable to set in every failure message', () => {
    expect(() => resolveApiProxyTarget({ API_PORT: '-1' })).toThrow(/VITE_API_PROXY_TARGET=/);
  });
});

describe('isLoopbackHost', () => {
  it('recognises the loopback forms TLS verification may be relaxed for', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
  });

  it('treats a real host as remote, so https verification stays on', () => {
    expect(isLoopbackHost('api.bault.example')).toBe(false);
    expect(isLoopbackHost('10.0.0.4')).toBe(false);
  });
});
