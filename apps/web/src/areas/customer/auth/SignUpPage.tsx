import { useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import {
  NAME_PART_MAX,
  isValidNamePart,
  isValidUsername,
  normalizeNamePart,
  normalizeUsername,
} from '../../../shared/names';
import { Button, ErrorState, SuccessNote } from '../../../shared/ui/primitives';

/**
 * Sign-up page — its own page, separate from sign-in.
 *
 * Registration does NOT yield a session: the account is created `pending` and the
 * API emails a verification link, so the page ends on a "check your mail" panel
 * with a way back to sign-in rather than entering the app.
 *
 * Four fields, and every one of them is required by the API:
 *
 *   - email;
 *   - USERNAME, captured here and nowhere else. It is permanent — there is no
 *     path anywhere in the app to change it, and the database rejects the write
 *     even if one were added (Requirement 4.1);
 *   - FIRST NAME and LAST NAME, two explicit fields. There is no display name to
 *     type: the full name is derived from these two wherever it is shown, so
 *     there is no second copy that can drift.
 *
 * The rules applied to the inputs are the same values the API enforces (see
 * `shared/names.ts`), so the button disables for exactly the input the server
 * would reject.
 */
export function SignUpPage({ onGoToSignIn }: { onGoToSignIn: () => void }) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [registered, setRegistered] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const normalizedUsername = normalizeUsername(username);
  const usernameOk = isValidUsername(normalizedUsername);
  const firstOk = isValidNamePart(normalizeNamePart(firstName));
  const lastOk = isValidNamePart(normalizeNamePart(lastName));
  // Only complain once something has been typed — an empty field a user has not
  // reached yet is not an error, it is a field they have not reached yet.
  const usernameError = username.length > 0 && !usernameOk;
  const firstNameError = firstName.length > 0 && !firstOk;
  const lastNameError = lastName.length > 0 && !lastOk;

  async function register(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // The response names the new account by its USERNAME. No intake ID is
      // issued any more, and nothing asks the user to keep one.
      const created = await api.post<{ username: string; firstName: string; lastName: string }>(
        '/auth/register',
        {
          email: email.trim(),
          username: normalizedUsername,
          firstName: normalizeNamePart(firstName),
          lastName: normalizeNamePart(lastName),
          password,
        },
      );
      setRegistered(t('auth.registerSuccess', { username: created.username }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /**
   * Ask for the verification mail again.
   *
   * The address is the one just typed, so nothing is re-entered. The endpoint
   * answers identically for a pending account and an unknown address, so the
   * confirmation says a link is on its way rather than asserting anything about
   * whether the account exists.
   */
  async function resendVerification() {
    setResending(true);
    setError(null);
    try {
      await api.post('/auth/verify-email/resend', { email: email.trim() });
      setResent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResending(false);
    }
  }

  if (registered) {
    return (
      <section className="auth-card">
        <h2>{t('auth.signUpTitle')}</h2>
        <SuccessNote>{registered}</SuccessNote>
        <p className="field-hint">{t('auth.verifySentHint')}</p>

        {resent ? (
          <SuccessNote>{t('auth.verifyResent')}</SuccessNote>
        ) : (
          <Button variant="secondary" block disabled={resending} onClick={() => void resendVerification()}>
            {t('auth.verifyResend')}
          </Button>
        )}

        {error && <ErrorState message={error} />}

        <Button variant="gold" block onClick={onGoToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </section>
    );
  }

  return (
    <form className="auth-card" onSubmit={register}>
      <h2>{t('auth.signUpTitle')}</h2>

      <label className="field">
        <span className="field-label">{t('auth.email')}</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          dir="ltr"
        />
      </label>

      <label className="field">
        <span className="field-label">{t('auth.username')}</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          aria-invalid={usernameError}
          aria-describedby="signup-username-hint"
          dir="ltr"
        />
        <span className={usernameError ? 'field-error' : 'field-hint'} id="signup-username-hint">
          {usernameError ? t('auth.usernameInvalid') : t('auth.usernameHint')}
        </span>
      </label>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">{t('auth.firstName')}</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            maxLength={NAME_PART_MAX}
            aria-invalid={firstNameError}
          />
          {firstNameError && <span className="field-error">{t('auth.nameInvalid')}</span>}
        </label>

        <label className="field">
          <span className="field-label">{t('auth.lastName')}</span>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            maxLength={NAME_PART_MAX}
            aria-invalid={lastNameError}
          />
          {lastNameError && <span className="field-error">{t('auth.nameInvalid')}</span>}
        </label>
      </div>

      <label className="field">
        <span className="field-label">{t('auth.password')}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          dir="ltr"
        />
        <span className="field-hint">{t('auth.passwordHint')}</span>
      </label>

      {error && <ErrorState message={error} />}

      <Button
        variant="gold"
        type="submit"
        block
        disabled={!usernameOk || !firstOk || !lastOk || password.length < 8 || !email.trim()}
      >
        {t('auth.signUp')}
      </Button>

      <p className="auth-switch">
        {t('auth.haveAccount')}{' '}
        <button className="btn--link" type="button" onClick={onGoToSignIn}>
          {t('auth.signIn')}
        </button>
      </p>
    </form>
  );
}
