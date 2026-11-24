import { describe, it, expect, vi } from 'vitest';
import {
  reportError,
  scrubBreadcrumb,
  scrubBrowserEvent,
  startErrorReporting,
  withoutQuery,
} from '../../apps/web/src/shared/errorReporting';

function stubSentry() {
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    breadcrumbsIntegration: vi.fn((options: unknown) => ({ name: 'Breadcrumbs', options })),
  };
}

describe('the web app error reporting', () => {
  it('loads nothing and sends nothing without a DSN', async () => {
    for (const dsn of [undefined, '', '   ']) {
      const load = vi.fn();
      expect(await startErrorReporting({ VITE_SENTRY_DSN: dsn, MODE: 'production' }, load)).toBe(false);
      expect(load).not.toHaveBeenCalled();
    }
    expect(() => reportError(new Error('nobody listens'))).not.toThrow();
  });

  it('starts with no personal data, the release and the environment when the DSN is set', async () => {
    const sentry = stubSentry();
    const started = await startErrorReporting(
      { VITE_SENTRY_DSN: 'https://publickey@o1.ingest.sentry.io/2', VITE_RELEASE: 'v1.4.0', MODE: 'production' },
      async () => sentry as never,
    );

    expect(started).toBe(true);
    const options = sentry.init.mock.calls[0]![0];
    expect(options).toMatchObject({
      dsn: 'https://publickey@o1.ingest.sentry.io/2',
      release: 'v1.4.0',
      environment: 'production',
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
    const integrations = options.integrations([{ name: 'Breadcrumbs' }, { name: 'GlobalHandlers' }]);
    expect(sentry.breadcrumbsIntegration).toHaveBeenCalledWith({ console: false });
    expect(integrations.map((i: { name: string }) => i.name)).toEqual(['GlobalHandlers', 'Breadcrumbs']);
    expect(options.beforeSend({ request: { cookies: { s: '1' } } })).toEqual({ request: {} });

    const failure = new Error('boom');
    reportError(failure, { componentStack: '\n    at Boom' });
    expect(sentry.captureException).toHaveBeenCalledWith(failure, {
      contexts: { react: { componentStack: '\n    at Boom' } },
    });
  });

  it('drops request bodies, cookies, credential headers, query strings and the user', () => {
    const event = scrubBrowserEvent({
      user: { ip_address: '203.0.113.9', email: 'red@example.com' },
      request: {
        url: 'https://app.example.com/?paypal=approved&token=EC-1#/reset-password?token=secret-reset',
        headers: { 'User-Agent': 'Firefox', Cookie: 'bault_session=abc', Authorization: 'Bearer x' },
        cookies: { bault_session: 'abc' },
        data: { password: 'hunter2' },
        query_string: 'token=EC-1',
      },
    });

    expect(event).toEqual({
      request: { url: 'https://app.example.com/#/reset-password', headers: { 'User-Agent': 'Firefox' } },
    });
    expect(JSON.stringify(event)).not.toMatch(/secret-reset|EC-1|hunter2|abc|203\.0\.113\.9|red@example/);
  });

  it('keeps no breadcrumb of what the collector typed or logged', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'searching for my Rayquaza slab' })).toBeNull();
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        data: { method: 'POST', url: '/api/v1/search?q=rayquaza', status_code: 500, body: '{"q":"rayquaza"}' },
      }),
    ).toEqual({ category: 'fetch', data: { method: 'POST', url: '/api/v1/search', status_code: 500 } });
    expect(
      scrubBreadcrumb({ category: 'navigation', data: { from: '/#/vault?q=mine', to: '/#/verify-email?token=t1' } }),
    ).toEqual({ category: 'navigation', data: { from: '/#/vault', to: '/#/verify-email' } });

    const event = scrubBrowserEvent({
      breadcrumbs: [
        { category: 'console', message: 'typed 4111 1111 1111 1111' },
        { category: 'ui.click', message: 'button.btn--primary' },
      ],
    });
    expect(event.breadcrumbs).toEqual([{ category: 'ui.click', message: 'button.btn--primary' }]);
  });

  it('cuts the query from the page and from the hash route', () => {
    expect(withoutQuery('https://a.example/x?y=1')).toBe('https://a.example/x');
    expect(withoutQuery('https://a.example/#/wallet?payment=p1')).toBe('https://a.example/#/wallet');
    expect(withoutQuery('/#/items')).toBe('/#/items');
  });
});
