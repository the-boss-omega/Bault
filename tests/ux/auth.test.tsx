import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Signing in, as a person does it.
 *
 * The first rendering tests this application has ever had. The production audit
 * found that 146 of 149 "web" cases were pure functions and nothing mounted a
 * component, so every screen was verified by the type checker alone — which
 * cannot see a button wired to the wrong handler, a form that submits the wrong
 * field, or an error that never reaches the screen.
 *
 * `api` is mocked at the module boundary rather than `fetch` being stubbed. The
 * component's contract is "call the API this way and render what comes back",
 * and that is exactly the seam worth pinning.
 */

const post = vi.fn();
const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  // `errorText` asks the module which failure this was.
  apiErrorKey: () => null,
}));

const { SignInPage } = await import('../../apps/web/src/areas/customer/auth/SignInPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  post.mockReset();
  get.mockReset();
});

describe('the sign-in form', () => {
  it('signs in with what the person typed, and hands the session up', async () => {
    const user = userEvent.setup();
    const onSignedIn = vi.fn();
    post.mockResolvedValue({ id: 'u1', role: 'user', username: 'red' });

    renderIn(
      <SignInPage onSignedIn={onSignedIn} onGoToSignUp={() => {}} onGoToForgotPassword={() => {}} />,
    );

    const [identifier, password] = screen.getAllByRole('textbox').length > 1
      ? screen.getAllByRole('textbox')
      : [screen.getByRole('textbox'), null];

    await user.clear(identifier!);
    await user.type(identifier!, 'golden');

    // The password field is not a textbox role; find it by its type.
    const pw = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.clear(pw);
    await user.type(pw, 'a-real-password');

    await user.click(screen.getByRole('button', { name: /sign in|התחבר/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/auth/login', {
      identifier: 'golden',
      password: 'a-real-password',
    });
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ id: 'u1', role: 'user', username: 'red' }));
  });

  it('shows the reason a sign-in was refused instead of failing silently', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error('Those credentials do not match an account.'));

    renderIn(
      <SignInPage onSignedIn={vi.fn()} onGoToSignUp={() => {}} onGoToForgotPassword={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: /sign in|התחבר/i }));

    expect(await screen.findByText(/do not match an account/i)).toBeInTheDocument();
  });

  it('does not leave the previous error on screen during a retry', async () => {
    const user = userEvent.setup();
    post.mockRejectedValueOnce(new Error('Wrong password.'));
    renderIn(
      <SignInPage onSignedIn={vi.fn()} onGoToSignUp={() => {}} onGoToForgotPassword={() => {}} />,
    );

    const submit = screen.getByRole('button', { name: /sign in|התחבר/i });
    await user.click(submit);
    expect(await screen.findByText(/wrong password/i)).toBeInTheDocument();

    // A stale error under a fresh attempt tells the user their new attempt
    // failed the old way.
    post.mockResolvedValueOnce({ id: 'u1', role: 'user' });
    await user.click(submit);
    await waitFor(() => expect(screen.queryByText(/wrong password/i)).not.toBeInTheDocument());
  });

  it('offers the two ways out of a failed sign-in', async () => {
    const user = userEvent.setup();
    const onGoToSignUp = vi.fn();
    const onGoToForgotPassword = vi.fn();
    renderIn(
      <SignInPage onSignedIn={vi.fn()} onGoToSignUp={onGoToSignUp} onGoToForgotPassword={onGoToForgotPassword} />,
    );

    await user.click(screen.getByRole('button', { name: /^sign up$/i }));
    expect(onGoToSignUp).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /forgot your password/i }));
    expect(onGoToForgotPassword).toHaveBeenCalled();
  });
});

describe('what the form ships with in it', () => {
  /**
   * This is a finding, pinned so it cannot come back.
   *
   * The sign-in form was written with `useState('red@bault.dev')` and
   * `useState('11111111')` — a working seeded account and its password, typed
   * into the login screen of every build, including a production one. Convenient
   * during development and indefensible in a deployment: it publishes a real
   * credential to anybody who loads the page.
   */
  it('starts empty rather than pre-filled once it is not a dev build', () => {
    // The suite runs with `import.meta.env.DEV` true, which is the branch that
    // KEEPS the convenience. What must be asserted is the other branch, so the
    // flag is stubbed to what a `vite build` produces.
    vi.stubEnv('DEV', false);
    try {
      renderIn(
        <SignInPage onSignedIn={vi.fn()} onGoToSignUp={() => {}} onGoToForgotPassword={() => {}} />,
      );

      const identifier = screen.getAllByRole('textbox')[0] as HTMLInputElement;
      const password = document.querySelector('input[type="password"]') as HTMLInputElement;

      expect(identifier.value, 'the identifier field ships pre-filled').toBe('');
      expect(password.value, 'the password field ships pre-filled').toBe('');

      // And the banner listing every seeded account with the shared password is
      // gone with it.
      expect(screen.queryByText(/password 11111111/i)).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
