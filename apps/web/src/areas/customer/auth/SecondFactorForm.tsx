import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../shared/api';
import { useT, type TranslateFn } from '../../../shared/i18n';
import { typedCode, useSecondsUntil, type MfaMethod } from '../../../shared/twoFactor';
import { Button, ErrorState, Field, SuccessNote } from '../../../shared/ui/primitives';
import type { SessionUser } from './AuthPage';
import { AuthCard } from './AuthCard';

/** What a right password earns an account with a second factor (POST /auth/login). */
export interface SecondFactorChallenge {
  challengeToken: string;
  expiresAt?: string;
  method?: MfaMethod;
  codeSent?: boolean;
  sentTo?: string | null;
  resendAfterSeconds?: number;
}

const inSeconds = (seconds: number | undefined) => (seconds && seconds > 0 ? Date.now() + seconds * 1000 : null);

export function waitText(t: TranslateFn, seconds: number): string {
  return seconds > 90 ? t('mfa.email.waitMinutes', { minutes: Math.ceil(seconds / 60) }) : t('mfa.email.wait', { seconds });
}

export function SecondFactorForm({
  challenge,
  onSignedIn,
  onRestart,
}: {
  challenge: SecondFactorChallenge;
  onSignedIn: (user: SessionUser) => void;
  onRestart: (reason: string | null) => void;
}) {
  const t = useT();
  const byEmail = challenge.method === 'email';
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(challenge.sentTo ?? null);
  const [codeSent, setCodeSent] = useState(challenge.codeSent !== false);
  const [resent, setResent] = useState(false);
  const [resendAt, setResendAt] = useState(() => inSeconds(challenge.resendAfterSeconds));
  const wait = useSecondsUntil(resendAt);

  /** A sign-in that timed out or was used goes back to the password; anything else is said here. */
  function fail(err: unknown) {
    if (err instanceof ApiError && err.code === 'mfa_challenge_expired') {
      onRestart(t('mfa.challengeExpired'));
      return;
    }
    setError((err as Error).message);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResent(false);
    try {
      const body = useRecovery
        ? { challengeToken: challenge.challengeToken, recoveryCode: recoveryCode.trim() }
        : { challengeToken: challenge.challengeToken, code: typedCode(code) };
      onSignedIn(await api.post<SessionUser>('/auth/login/mfa', body));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setSending(true);
    setError(null);
    setResent(false);
    try {
      const res = await api.post<{ sentTo: string; resendAfterSeconds: number }>('/auth/login/mfa/resend', {
        challengeToken: challenge.challengeToken,
      });
      setSentTo(res.sentTo);
      setCodeSent(true);
      setResent(true);
      setCode('');
      setResendAt(inSeconds(res.resendAfterSeconds));
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
    }
  }

  const intro = !byEmail
    ? t('mfa.challenge.intro')
    : codeSent && sentTo
      ? t('mfa.email.sent', { email: sentTo })
      : t('mfa.email.notSent');

  return (
    <AuthCard
      kicker={t('auth.kicker.mfa')}
      title={t('mfa.title')}
      onSubmit={submit}
      stub={
        <>
          <p className="auth-switch">
            <Button
              variant="link"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setError(null);
              }}
            >
              {useRecovery ? (byEmail ? t('mfa.useEmail') : t('mfa.useApp')) : t('mfa.useRecovery')}
            </Button>
          </p>
          <p className="auth-switch">
            <Button variant="link" onClick={() => onRestart(null)}>
              {t('auth.backToSignIn')}
            </Button>
          </p>
        </>
      }
    >
      <p className="hint">{intro}</p>

      {useRecovery ? (
        <Field label={t('mfa.recoveryCode')} hint={t('mfa.recoveryCodeHint')}>
          <input
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            dir="ltr"
          />
        </Field>
      ) : (
        <Field label={byEmail ? t('mfa.email.code') : t('mfa.code')} hint={byEmail ? t('mfa.email.codeHint') : t('mfa.codeHint')}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            autoFocus
            dir="ltr"
          />
        </Field>
      )}

      {byEmail && !useRecovery && (
        <div className="row mfa-resend">
          <Button size="sm" disabled={wait > 0} loading={sending} onClick={() => void resend()}>
            {t('mfa.email.resend')}
          </Button>
          {wait > 0 && <span className="field-hint">{waitText(t, wait)}</span>}
        </div>
      )}

      {resent && sentTo && <SuccessNote>{t('mfa.email.resent', { email: sentTo })}</SuccessNote>}
      {error && <ErrorState message={error} />}

      <Button variant="primary" type="submit" block loading={busy}>
        {t('mfa.verify')}
      </Button>
    </AuthCard>
  );
}
