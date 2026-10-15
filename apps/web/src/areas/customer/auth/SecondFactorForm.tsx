import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { typedCode } from '../../../shared/twoFactor';
import { Button, ErrorState, Field } from '../../../shared/ui/primitives';
import type { SessionUser } from './AuthPage';

/**
 * The second sign-in step: a code from the authenticator app, or a recovery
 * code.
 *
 * Reached only after a right password for an account with two-factor sign-in
 * — the API then answers with a challenge instead of a session — and holds
 * nothing but that challenge. The password is not kept for this step and is not
 * sent again.
 *
 * A wrong code stays here: retyping the password is not the remedy for a
 * mistyped code. An expired, used or burned challenge goes back to the password
 * step with a sentence saying why, because there is nothing left on this screen
 * that can work.
 */
export function SecondFactorForm({
  challengeToken,
  onSignedIn,
  onRestart,
}: {
  challengeToken: string;
  onSignedIn: (user: SessionUser) => void;
  /** Back to the password, with the reason to show there. */
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
      // Authenticator apps show "123 456"; people type it that way.
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
    <form className="auth-card" onSubmit={submit}>
      <h2>{t('mfa.title')}</h2>
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
          {/* `one-time-code` lets a phone offer the code it just received
              from an authenticator; numeric brings up the number pad. */}
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

      <Button variant="gold" type="submit" block loading={busy}>
        {t('mfa.verify')}
      </Button>

      <p className="auth-switch">
        <button
          className="btn--link"
          type="button"
          onClick={() => {
            setUseRecovery(!useRecovery);
            setError(null);
          }}
        >
          {useRecovery ? t('mfa.useApp') : t('mfa.useRecovery')}
        </button>
      </p>
      <p className="auth-switch">
        <button className="btn--link" type="button" onClick={() => onRestart(null)}>
          {t('auth.backToSignIn')}
        </button>
      </p>
    </form>
  );
}
