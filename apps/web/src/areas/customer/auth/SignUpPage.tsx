import { useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import {
  NAME_PART_MAX,
  PASSWORD_MIN,
  isValidNamePart,
  isValidUsername,
  normalizeNamePart,
  normalizeUsername,
} from '../../../shared/names';
import { Button, ErrorState, Field, SuccessNote } from '../../../shared/ui/primitives';

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
  // Sign-in has had this since it was written; sign-up did not, so the one form
  // in the product that creates an account was also the one that could be
  // submitted twice by pressing the button twice.
  const [busy, setBusy] = useState(false);
  const t = useT();

  const normalizedUsername = normalizeUsername(username);
  const usernameOk = isValidUsername(normalizedUsername);
  const firstOk = isValidNamePart(normalizeNamePart(firstName));
  const lastOk = isValidNamePart(normalizeNamePart(lastName));
  /**
   * Email and password are checked here for the same reason the other three
   * are: they gate the button.
   *
   * They were the two that did not. The button disabled on `!email.trim()` and
   * `password.length < 8`, so somebody who typed `nope` into the address field,
   * or a six-character password, saw a dead button and no statement of what was
   * wrong with it — while the field directly above explained itself. A disabled
   * control that will not say why is worse than an enabled one that fails, and
   * every other field on this form already did better.
   *
   * The address test is the shape the API's `@IsEmail` accepts, kept loose on
   * purpose: this is here to catch a typo, not to adjudicate RFC 5322.
   */
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordOk = password.length >= PASSWORD_MIN;
  // Only complain once something has been typed — an empty field a user has not
  // reached yet is not an error, it is a field they have not reached yet.
  const usernameError = username.length > 0 && !usernameOk;
  const firstNameError = firstName.length > 0 && !firstOk;
  const lastNameError = lastName.length > 0 && !lastOk;
  const emailError = email.length > 0 && !emailOk;
  const passwordError = password.length > 0 && !passwordOk;

  async function register(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
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
    } finally {
      setBusy(false);
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

      {/*
        `Field` throughout rather than a wrapping <label>.
        A <label> that encloses BOTH the caption and the hint takes all of that
        text as the control's accessible name, so this form announced its address
        field as "EmailWe send a confirmation link here" — and the four fields
        that carried hints or errors each did the same. `Field` points the label
        at the control by id and attaches the hint with `aria-describedby`, which
        is where a description belongs.
      */}
      <Field
        label={t('auth.email')}
        htmlFor="signup-email"
        hint={t('auth.emailHint')}
        error={emailError ? t('auth.emailInvalid') : undefined}
      >
        <input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          aria-invalid={emailError}
          dir="ltr"
        />
      </Field>

      <Field
        label={t('auth.username')}
        htmlFor="signup-username"
        hint={t('auth.usernameHint')}
        error={usernameError ? t('auth.usernameInvalid') : undefined}
      >
        <input
          id="signup-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          aria-invalid={usernameError}
          dir="ltr"
        />
      </Field>

      <div className="form-grid">
        <Field
          label={t('auth.firstName')}
          htmlFor="signup-first"
          error={firstNameError ? t('auth.nameInvalid') : undefined}
        >
          <input
            id="signup-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            maxLength={NAME_PART_MAX}
            aria-invalid={firstNameError}
          />
        </Field>

        <Field
          label={t('auth.lastName')}
          htmlFor="signup-last"
          error={lastNameError ? t('auth.nameInvalid') : undefined}
        >
          <input
            id="signup-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            maxLength={NAME_PART_MAX}
            aria-invalid={lastNameError}
          />
        </Field>
      </div>

      <Field
        label={t('auth.password')}
        htmlFor="signup-password"
        hint={t('auth.passwordHint')}
        error={passwordError ? t('auth.passwordTooShort', { min: PASSWORD_MIN }) : undefined}
      >
        <input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          aria-invalid={passwordError}
          dir="ltr"
        />
      </Field>

      {error && <ErrorState message={error} />}

      <Button
        variant="gold"
        type="submit"
        block
        loading={busy}
        disabled={!usernameOk || !firstOk || !lastOk || !passwordOk || !emailOk}
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
