import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';

/**
 * Three screens that each had one way to show the wrong thing: the e-mail
 * verification page, the render-failure fallback, and the two-factor panel when
 * its first read fails.
 *
 * `api` is mocked at the module boundary, as in the other rendering suites.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { VerifyEmailPage } = await import('../../apps/web/src/areas/customer/auth/VerifyEmailPage');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

/* ============================================================
   Verifying an e-mail address
   ============================================================ */

/** A promise the test settles by hand. */
function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('the verification page', () => {
  it('spends the link once, and says it worked, when the app runs its effects twice (StrictMode)', async () => {
    // The token is single-use: the first request spends it and a second one is
    // refused. In development StrictMode mounts, unmounts and mounts again.
    post
      .mockResolvedValueOnce({ status: 'verified' })
      .mockRejectedValue(new Error('This link has expired or was already used.'));
    // At the root, as `main.tsx` mounts it: React double-runs effects only for
    // a tree that is strict from the top.
    render(
      <StrictMode>
        <I18nProvider>
          <VerifyEmailPage token="tok-strict" />
        </I18nProvider>
      </StrictMode>,
    );

    expect(await screen.findByText(/your address is confirmed/i)).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/already used/i)).not.toBeInTheDocument();
  });

  it('shows the answer for the link it is showing, not a late one for the link before', async () => {
    const first = deferred();
    const second = deferred();
    post.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = renderIn(<VerifyEmailPage token="tok-a" />);
    view.rerender(
      <I18nProvider>
        <VerifyEmailPage token="tok-b" />
      </I18nProvider>,
    );

    second.resolve({ status: 'verified' });
    expect(await screen.findByText(/your address is confirmed/i)).toBeInTheDocument();
    // The first request answers last, and is about a link nobody is looking at.
    first.reject(new Error('This link has expired or was already used.'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(/your address is confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/already used/i)).not.toBeInTheDocument();
  });
});
