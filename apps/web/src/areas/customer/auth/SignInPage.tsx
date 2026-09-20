import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { errorText } from '../../../shared/errors';
import { Button, ErrorState, Field, SuccessNote } from '../../../shared/ui/primitives';
import type { SessionUser } from './AuthPage';
import { DEMO_USERS } from './demoUsers';

/**
 * Sign-in page — credentials only. Registration lives on its own page
 * (`SignUpPage`); the two never share a form.
 *
 * On success the API sets an httpOnly session cookie and returns the user's id +
 * role, which the app shell uses to decide which destinations to show.
 */
export function SignInPage({
  onSignedIn,
  onGoToSignUp,
  onGoToForgotPassword,
}: {
  onSignedIn: (user: SessionUser) => void;
  onGoToSignUp: () => void;
  onGoToForgotPassword: () => void;
}) {
  // ONE identifier field: the email or the username, either on its own.
  //
  // EMPTY in any build that is not a local dev server. These two fields shipped
  // pre-filled with `red@bault.dev` / `11111111` — a real seeded account and its
  // real password, typed into the login screen of every build including a
  // production one. Convenient locally and indefensible in a deployment: it
  // publishes a working credential to anybody who loads the page.
  //
  // `import.meta.env.DEV` is false in every `vite build` output, so the
  // convenience survives exactly where it belongs and nowhere else.
  const [identifier, setIdentifier] = useState(import.meta.env.DEV ? 'red@bault.dev' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? '11111111' : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The sign-in refusal that has a remedy, held apart from the rest.
   *
   * Somebody who signed up and never clicked the link was told their address is
   * unconfirmed and then left on a page offering "Forgot password" — which does
   * not help — and "Sign up", which answers that the address is already
   * registered. `POST /auth/verify-email/resend` existed the whole time, and the
   * only page in the signed-out app that could reach it was the one you arrive
   * at by following the very link they no longer have. A closed loop, so the way
   * out is offered here, where the door was shut.
   */
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const t = useT();

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    setResent(false);
    try {
      const user = await api.post<SessionUser>('/auth/login', { identifier, password });
      onSignedIn(user);
    } catch (err) {
      setError(errorText(t, err));
      setUnverified(err instanceof ApiError && err.code === 'email_unverified');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The address is whatever was typed into the identifier field. When that was a
   * username rather than an email the endpoint answers exactly as it answers an
   * unknown address — a confirmation that a link is on its way, asserting
   * nothing about whether an account exists — so nothing here has to guess.
   */
  async function resendVerification() {
    setBusy(true);
    try {
      await api.post('/auth/verify-email/resend', { email: identifier.trim() });
      setResent(true);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={login}>
      <h2>{t('auth.signInTitle')}</h2>

      {/* `Field` rather than a wrapping <label>: the caption is a real
          <label for>, so clicking it focuses the input and a screen reader
          announces the caption alone as the field's name instead of the caption
          and its hint run together. */}
      <Field label={t('auth.identifier')} hint={t('auth.identifierHint')} htmlFor="signin-identifier">
        <input
          id="signin-identifier"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          aria-describedby="signin-identifier-hint"
          dir="ltr"
        />
      </Field>

      <Field label={t('auth.password')} htmlFor="signin-password">
        <input
          id="signin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          dir="ltr"
        />
      </Field>

      {error && <ErrorState message={error} />}

      {/* The remedy, directly under the refusal that needs it. */}
      {unverified &&
        (resent ? (
          <SuccessNote>{t('auth.verifyResent')}</SuccessNote>
        ) : (
          <Button variant="secondary" block disabled={busy} onClick={() => void resendVerification()}>
            {t('auth.verifyResend')}
          </Button>
        ))}

      {/* Busy rather than merely disabled: a form whose only feedback is that
          nothing happens gets pressed twice. */}
      <Button variant="gold" type="submit" block loading={busy}>
        {t('auth.signIn')}
      </Button>

      {/* Recovery sits directly under the button that just failed, which is
          where someone looks after a rejected password — not in a footer. */}
      <p className="auth-switch">
        <button className="btn--link" type="button" onClick={onGoToForgotPassword}>
          {t('auth.forgotLink')}
        </button>
      </p>

      <p className="auth-switch">
        {t('auth.noAccount')}{' '}
        <button className="btn--link" type="button" onClick={onGoToSignUp}>
          {t('auth.signUp')}
        </button>
      </p>

      {/* The same rule, for the same reason, and this one is worse: it printed
          every seeded account AND the shared password on screen for anyone who
          opened the page. */}
      {import.meta.env.DEV && <p className="auth-demo">{DEMO_USERS}</p>}
    </form>
  );
}
