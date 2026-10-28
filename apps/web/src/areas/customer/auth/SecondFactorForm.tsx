import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { typedCode } from '../../../shared/twoFactor';
import { Button, ErrorState, Field } from '../../../shared/ui/primitives';
import type { SessionUser } from './AuthPage';
import { AuthCard } from './AuthCard';

export function SecondFactorForm({
  challengeToken,
  onSignedIn,
  onRestart,
}: {
  challengeToken: string;
  onSignedIn: (user: SessionUser) => void;
  onRestart: (reason: string | null) => void;
}) {
  const t = useT();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = useRecovery
        ? { challengeToken, recoveryCode: recoveryCode.trim() }
        : { challengeToken, code: typedCode(code) };
      onSignedIn(await api.post<SessionUser>('/auth/login/mfa', body));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'mfa_challenge_expired') {
        onRestart(t('mfa.challengeExpired'));
        return;
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
              {useRecovery ? t('mfa.useApp') : t('mfa.useRecovery')}
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
      <p className="hint">{t('mfa.challenge.intro')}</p>

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
        <Field label={t('mfa.code')} hint={t('mfa.codeHint')}>
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

      {error && <ErrorState message={error} />}

      <Button variant="primary" type="submit" block loading={busy}>
        {t('mfa.verify')}
      </Button>
    </AuthCard>
  );
}
