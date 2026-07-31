import { useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import type { SessionUser } from './AuthPage';

/**
 * Sign-in page — credentials only. Registration lives on its own page
 * (`SignUpPage`); the two never share a form.
 *
 * On success the API sets an httpOnly session cookie and returns the user's id +
 * role, which the app shell uses to decide which areas to show.
 */
export function SignInPage({
  onSignedIn,
  onGoToSignUp,
}: {
  onSignedIn: (user: SessionUser) => void;
  onGoToSignUp: () => void;
}) {
  // ONE identifier field: the email or the username, either on its own.
  const [identifier, setIdentifier] = useState('red@bault.dev');
  const [password, setPassword] = useState('11111111');
  const [message, setMessage] = useState<string | null>(null);
  const t = useT();

  async function login(e: FormEvent) {
    e.preventDefault();
    try {
      const user = await api.post<SessionUser>('/auth/login', { identifier, password });
      onSignedIn(user);
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <form className="card auth-card" onSubmit={login}>
      <h2>{t('auth.signInTitle')}</h2>
      <label>
        {t('auth.identifier')}
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          dir="ltr"
        />
      </label>
      <p className="hint">{t('auth.identifierHint')}</p>
      <label>
        {t('auth.password')}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          dir="ltr"
        />
      </label>
      <div className="actions">
        <button className="btn btn--primary" type="submit">{t('auth.signIn')}</button>
      </div>
      <p className="auth-switch">
        {t('auth.noAccount')}{' '}
        <button className="btn--link" type="button" onClick={onGoToSignUp}>
          {t('auth.signUp')}
        </button>
      </p>
      <p className="hint">{t('auth.demoUsers')}</p>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
