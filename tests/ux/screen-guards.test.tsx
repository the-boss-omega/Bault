import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { VerifyEmailPage } = await import('../../apps/web/src/areas/customer/auth/VerifyEmailPage');
const { ErrorBoundary } = await import('../../apps/web/src/shared/ui/ErrorBoundary');
const { TwoFactorPanel } = await import('../../apps/web/src/areas/customer/profile/TwoFactorPanel');
const STYLESHEET = 'apps/web/src/index.css';

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

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
    post
      .mockResolvedValueOnce({ status: 'verified' })
      .mockRejectedValue(new Error('This link has expired or was already used.'));
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
    first.reject(new Error('This link has expired or was already used.'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(/your address is confirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/already used/i)).not.toBeInTheDocument();
  });
});

describe('the render-failure fallback', () => {
  let quiet: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => quiet.mockRestore());

  it('styles its buttons with classes the stylesheet defines', () => {
    function Boom(): React.ReactElement {
      throw new Error('boom');
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    const css = readFileSync(STYLESHEET, 'utf8');
    const buttons = [
      screen.getByRole('button', { name: /try again/i }),
      screen.getByRole('button', { name: /reload the page/i }),
    ];
    for (const button of buttons) {
      for (const cls of button.classList) {
        const selector = new RegExp(`\\.${cls.replace(/[-]/g, '\\-')}(?![\\w-])`);
        expect(css, `.${cls} is not defined in index.css`).toMatch(selector);
      }
    }
    expect(buttons[0]).toHaveClass('btn--gold');
  });
});

describe('the two-factor panel', () => {
  it('offers to try again when the status cannot be read, and shows it once it can', async () => {
    const user = userEvent.setup();
    get
      .mockRejectedValueOnce(new Error('The server could not be reached.'))
      .mockResolvedValue({ enabled: false, pending: false, required: false, recoveryCodesRemaining: 0 });
    renderIn(<TwoFactorPanel />);

    expect(await screen.findByText(/could not be reached/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('button', { name: /set up two-factor sign-in/i })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/could not be reached/i)).not.toBeInTheDocument();
  });
});
