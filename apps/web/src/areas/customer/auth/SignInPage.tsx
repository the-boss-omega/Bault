import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { Button, ErrorState, Field, SuccessNote } from '../../../shared/ui/primitives';
import type { SessionUser } from './AuthPage';
import { DEMO_USERS } from './demoUsers';
import { SecondFactorForm } from './SecondFactorForm';

/** What a right password returns for an account with two-factor sign-in, instead of a session. */
interface MfaChallenge {
  status: 'mfa_required';
  challengeToken: string;
  expiresAt: string;
}

function isChallenge(body: SessionUser | MfaChallenge): body is MfaChallenge {
  return (body as MfaChallenge).status === 'mfa_required';
}

/**
 * Sign-in page: credentials only. Registration lives on its own page
 * (`SignUpPage`); the two never share a form.
 *
 * On success the API sets an httpOnly session cookie and returns the user's id
 * and role, which the app shell uses to decide which destinations to show.
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
  // One identifier field: the email or the username, either on its own.
  //
  // Pre-filled with a seeded account only on a local dev server.
  // `import.meta.env.DEV` is false in every `vite build` output, so no built
  // bundle carries a working credential.
  const [identifier, setIdentifier] = useState(import.meta.env.DEV ? 'red@bault.dev' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? '11111111' : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The sign-in refusal that has a remedy, held apart from the rest: an
   * unconfirmed address is offered a new confirmation link here
   * (`POST /auth/verify-email/resend`), where the sign-in was refused.
   */
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  /**
   * The challenge a right password earned, for an account with two-factor
   * sign-in. While it is set the page is the second step; the password is
   * cleared, because it has done its job and is not sent again.
   */
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const t = useT();

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    setResent(false);
    try {
      const answer = await api.post<SessionUser | MfaChallenge>('/auth/login', { identifier, password });
      if (isChallenge(answer)) {
        setPassword('');
        setChallenge(answer);
        return;
      }
      onSignedIn(answer);
    } catch (err) {
      setError((err as Error).message);
      setUnverified(err instanceof ApiError && err.code === 'email_unverified');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The address is whatever was typed into the identifier field. When that was a
   * username rather than an email, the endpoint answers exactly as it answers an
   * unknown address (a link is on its way, asserting nothing about whether an
   * account exists), so nothing here has to guess.
   */
  async function resendVerification() {
    setBusy(true);
    try {
      await api.post('/auth/verify-email/resend', { email: identifier.trim() });
      setResent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <SecondFactorForm
        challengeToken={challenge.challengeToken}
        onSignedIn={onSignedIn}
        onRestart={(reason) => {
          setChallenge(null);
          setError(reason);
        }}
      />
    );
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
          where someone looks after a rejected password. */}
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

      {/* Development only, like the pre-filled fields; see demoUsers.ts. */}
      {import.meta.env.DEV && <p className="auth-demo">{DEMO_USERS}</p>}
    </form>
  );
}
