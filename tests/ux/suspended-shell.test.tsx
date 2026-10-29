import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const get = vi.fn();

class MockApiError extends Error {
  constructor(
    readonly kind: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: MockApiError,
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { default: App } = await import('../../apps/web/src/App');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ThemeProvider } = await import('../../apps/web/src/shared/theme');

const shell = () =>
  render(
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>,
  );

const profile = (status: string) => ({
  id: 'me',
  role: 'user',
  status,
  email: 'dana@bault.dev',
  username: 'dana',
  firstName: 'Dana',
  lastName: 'Okonkwo',
  fullName: 'Dana Okonkwo',
  nameReviewRequired: false,
  mfaRequired: false,
  mfaEnabled: false,
});

/** The bell in the header's controls (the rail has a way to the notifications of its own). */
const bell = () => document.querySelector('.ph-controls button[aria-haspopup="dialog"]');

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  window.location.hash = '#/support';
});

describe('the shell of an account that is suspended', () => {
  it('does not ask for the notifications it is refused, and has no bell for what it cannot read', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/me/profile') return profile('suspended');
      // What the server does of a suspended account: the feed is refused; the support desk is open.
      if (path === '/notifications') throw new MockApiError('http', 403, 'Forbidden');
      return [];
    });
    shell();
    await screen.findByText(/account suspended/i);
    expect(get.mock.calls.map((call) => call[0])).not.toContain('/notifications');
    expect(bell()).toBeNull();
    // The theme and the language are still there, as the pair they are.
    expect(document.querySelectorAll('.ph-controls > *')).toHaveLength(2);
  });

  it('keeps the bell for an account that is not', async () => {
    get.mockImplementation(async (path: string) =>
      path === '/me/profile' ? profile('active') : [],
    );
    window.location.hash = '#/vault';
    shell();
    await waitFor(() => expect(bell()).not.toBeNull());
    expect(document.querySelectorAll('.ph-controls > *')).toHaveLength(3);
    expect(get.mock.calls.map((call) => call[0])).toContain('/notifications');
  });
});
