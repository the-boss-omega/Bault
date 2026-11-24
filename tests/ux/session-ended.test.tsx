import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { default: App } = await import('../../apps/web/src/App');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ThemeProvider } = await import('../../apps/web/src/shared/theme');
const { resetProfileRequest } = await import('../../apps/web/src/shared/session');

const realFetch = globalThis.fetch;

const PROFILE = {
  id: 'me',
  role: 'user',
  status: 'active',
  email: 'dana@bault.dev',
  username: 'dana',
  firstName: 'Dana',
  lastName: 'Okonkwo',
  fullName: 'Dana Okonkwo',
  nameReviewRequired: false,
  mfaRequired: false,
  mfaEnabled: false,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  resetProfileRequest();
  localStorage.clear();
  window.location.hash = '#/support';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('a session that ends while the app is open', () => {
  it('goes back to sign-in and says why, instead of "Authentication required" on every screen', async () => {
    let profileCalls = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/me/profile') && profileCalls++ === 0) return json(200, PROFILE);
      return json(401, { error: { code: 'unauthenticated', message: 'Authentication required' } });
    }) as typeof fetch;

    render(
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText('Your session ended, sign in again.')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/signin'));
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByText('Authentication required')).toBeNull();
  });

  it('shows the plain sentence for a server failure, not the server\'s own words', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/me/profile')) return json(200, PROFILE);
      return json(500, { error: { code: 'internal', message: 'Internal server error' } });
    }) as typeof fetch;

    render(
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>,
    );

    expect((await screen.findAllByText('The server failed to answer. Try again in a moment.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Internal server error')).toBeNull();
  });
});
