import { useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';

/**
 * Sign-up page — its own page, separate from sign-in.
 *
 * Registration does NOT yield a session: the account is created `pending` and the
 * API emails a verification link, so the page ends on a "check your mail" panel
 * with a way back to sign-in rather than entering the app.
 */
export function SignUpPage({ onGoToSignIn }: { onGoToSignIn: () => void }) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registered, setRegistered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  // The username is captured HERE and nowhere else — once registered it is
  // permanent and there is no path anywhere in the app to change it (Req 4.1).
  async function register(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ intakeId: string }>('/auth/register', {
        email,
        username,
        password,
      });
      setRegistered(t('auth.registerSuccess', { intakeId: r.intakeId }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (registered) {
    return (
      <section className="card auth-card">
        <h2>{t('auth.signUpTitle')}</h2>
        <p role="status">{registered}</p>
        <div className="actions">
          <button className="btn btn--primary" type="button" onClick={onGoToSignIn}>
            {t('auth.goToSignIn')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="card auth-card" onSubmit={register}>
      <h2>{t('auth.signUpTitle')}</h2>
      <label>
        {t('auth.email')}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          dir="ltr"
        />
      </label>
      <label>
        {t('auth.username')}
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          dir="ltr"
        />
      </label>
      <p className="hint">{t('auth.usernameHint')}</p>
      <label>
        {t('auth.password')}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          dir="ltr"
        />
      </label>
      <p className="hint">{t('auth.passwordHint')}</p>
      <div className="actions">
        <button
          className="btn btn--primary"
          type="submit"
          disabled={username.trim().length < 3 || password.length < 8 || !email.trim()}
        >
          {t('auth.signUp')}
        </button>
      </div>
      <p className="auth-switch">
        {t('auth.haveAccount')}{' '}
        <button className="btn--link" type="button" onClick={onGoToSignIn}>
          {t('auth.signIn')}
        </button>
      </p>
      {error && <p role="status">{error}</p>}
    </form>
  );
}
