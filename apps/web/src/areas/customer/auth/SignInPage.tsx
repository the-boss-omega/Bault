import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { Button, ErrorState, Field, SuccessNote } from '../../../shared/ui/primitives';
import type { SessionUser } from './AuthPage';
import { DEMO_USERS } from './demoUsers';
import { AuthCard } from './AuthCard';
import { SecondFactorForm } from './SecondFactorForm';

interface MfaChallenge {
  status: 'mfa_required';
  challengeToken: string;
  expiresAt: string;
}

function isChallenge(body: SessionUser | MfaChallenge): body is MfaChallenge {
  return (body as MfaChallenge).status === 'mfa_required';
}

export function SignInPage({
  onSignedIn,
  onGoToSignUp,
  onGoToForgotPassword,
}: {
  onSignedIn: (user: SessionUser) => void;
  onGoToSignUp: () => void;
  onGoToForgotPassword: () => void;
}) {
  const [identifier, setIdentifier] = useState(import.meta.env.DEV ? 'red@bault.dev' : '');
  const [password, setPassword] = useState(import.meta.env.DEV ? '11111111' : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
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
    <AuthCard
      kicker={t('auth.kicker.signIn')}
      title={t('auth.signInTitle')}
      onSubmit={login}
      stub={
        <>
          <p className="auth-switch">
            <Button variant="link" onClick={onGoToForgotPassword}>
              {t('auth.forgotLink')}
            </Button>
          </p>

          <p className="auth-switch">
            {t('auth.noAccount')}{' '}
            <Button variant="link" onClick={onGoToSignUp}>
              {t('auth.signUp')}
            </Button>
          </p>

          {import.meta.env.DEV && <p className="auth-demo">{DEMO_USERS}</p>}
        </>
      }
    >
      <Field
        label={t('auth.identifier')}
        hint={t('auth.identifierHint')}
        htmlFor="signin-identifier"
      >
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

      {unverified &&
        (resent ? (
          <SuccessNote>{t('auth.verifyResent')}</SuccessNote>
        ) : (
          <Button variant="secondary" block disabled={busy} onClick={() => void resendVerification()}>
            {t('auth.verifyResend')}
          </Button>
        ))}

      <Button variant="primary" type="submit" block loading={busy}>
        {t('auth.signIn')}
      </Button>
    </AuthCard>
  );
}
