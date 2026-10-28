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
import { AuthCard } from './AuthCard';
import { TERMS_VERSION } from '../help/legalContent';
import { TermsReader } from '../help/LegalDocumentView';

export function SignUpPage({ onGoToSignIn }: { onGoToSignIn: () => void }) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [registered, setRegistered] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();

  const normalizedUsername = normalizeUsername(username);
  const usernameOk = isValidUsername(normalizedUsername);
  const firstOk = isValidNamePart(normalizeNamePart(firstName));
  const lastOk = isValidNamePart(normalizeNamePart(lastName));
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordOk = password.length >= PASSWORD_MIN;
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
      const created = await api.post<{ username: string; firstName: string; lastName: string }>(
        '/auth/register',
        {
          email: email.trim(),
          username: normalizedUsername,
          firstName: normalizeNamePart(firstName),
          lastName: normalizeNamePart(lastName),
          password,
          acceptedTermsVersion: TERMS_VERSION,
        },
      );
      setRegistered(t('auth.registerSuccess', { username: created.username }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
      <AuthCard as="section" kicker={t('auth.kicker.signUp')} title={t('auth.signUpTitle')}>
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

        <Button variant="primary" block onClick={onGoToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      kicker={t('auth.kicker.signUp')}
      title={t('auth.signUpTitle')}
      onSubmit={register}
      stub={
        <p className="auth-switch">
          {t('auth.haveAccount')}{' '}
          <Button variant="link" onClick={onGoToSignIn}>
            {t('auth.signIn')}
          </Button>
        </p>
      }
    >
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

      <div className="consent">
        <label className="check">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            required
            aria-describedby="signup-consent-hint"
          />
          <span>{t('auth.consentLabel', { version: TERMS_VERSION })}</span>
        </label>
        <p className="field-hint" id="signup-consent-hint">
          {t('auth.consentHint')}{' '}
          <Button
            variant="link"
            aria-expanded={showTerms}
            aria-controls="signup-terms"
            onClick={() => setShowTerms((v) => !v)}
          >
            {showTerms ? t('auth.consentHide') : t('auth.consentRead')}
          </Button>
        </p>
        {showTerms && <TermsReader id="signup-terms" />}
      </div>

      {error && <ErrorState message={error} />}

      <Button
        variant="primary"
        type="submit"
        block
        loading={busy}
        disabled={!usernameOk || !firstOk || !lastOk || !passwordOk || !emailOk || !accepted}
      >
        {t('auth.signUp')}
      </Button>
    </AuthCard>
  );
}
