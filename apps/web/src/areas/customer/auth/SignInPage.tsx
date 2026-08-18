import { useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { Button, ErrorState } from '../../../shared/ui/primitives';
import type { SessionUser } from './AuthPage';

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
  const [identifier, setIdentifier] = useState('red@bault.dev');
  const [password, setPassword] = useState('11111111');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.post<SessionUser>('/auth/login', { identifier, password });
      onSignedIn(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={login}>
      <h2>{t('auth.signInTitle')}</h2>

      <label className="field">
        <span className="field-label">{t('auth.identifier')}</span>
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          dir="ltr"
        />
        <span className="field-hint">{t('auth.identifierHint')}</span>
      </label>

      <label className="field">
        <span className="field-label">{t('auth.password')}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          dir="ltr"
        />
      </label>

      {error && <ErrorState message={error} />}

      <Button variant="gold" type="submit" block disabled={busy}>
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

      <p className="auth-demo">{t('auth.demoUsers')}</p>
    </form>
  );
}
