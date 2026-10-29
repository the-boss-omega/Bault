import { useState, type FormEvent } from 'react';
import { ApiError, api, apiErrorKey } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { navigate } from '../../../shared/routing';
import { PASSWORD_MIN } from '../../../shared/names';
import { Button, ErrorState, Field, SuccessNote } from '../../../shared/ui/primitives';
import { AuthCard } from './AuthCard';

export function ResetPasswordPage({ token }: { token: string | null }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 8 && confirm === password;

  function goToSignIn() {
    navigate({ section: '' }, { replace: true });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/reset', { token, newPassword: password });
      setDone(true);
    } catch (err) {
      const key = err instanceof ApiError && err.status === 410 ? 'auth.resetLinkInvalid' : apiErrorKey(err);
      setError(key ? t(key) : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthCard as="section" kicker={t('auth.kicker.reset')} title={t('auth.resetTitle')}>
        <ErrorState message={t('auth.resetNoToken')} />
        <Button variant="primary" block onClick={goToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard as="section" kicker={t('auth.kicker.reset')} title={t('auth.resetTitle')}>
        <SuccessNote>{t('auth.resetDone')}</SuccessNote>
        <Button variant="primary" block onClick={goToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      kicker={t('auth.kicker.reset')}
      title={t('auth.resetTitle')}
      onSubmit={submit}
      stub={
        <p className="auth-switch">
          <Button variant="link" onClick={goToSignIn}>
            {t('auth.backToSignIn')}
          </Button>
        </p>
      }
    >
      <p className="field-hint">{t('auth.resetIntro')}</p>

      <Field
        label={t('auth.newPassword')}
        hint={t('auth.passwordHint')}
        error={tooShort ? t('auth.passwordTooShort', { min: PASSWORD_MIN }) : undefined}
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          aria-invalid={tooShort}
          dir="ltr"
        />
      </Field>

      <Field
        label={t('auth.confirmPassword')}
        error={mismatch ? t('auth.passwordMismatch') : undefined}
      >
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          aria-invalid={mismatch}
          dir="ltr"
        />
      </Field>

      {error && <ErrorState message={error} />}

      <Button variant="primary" type="submit" block disabled={busy || !ready}>
        {t('auth.resetSubmit')}
      </Button>
    </AuthCard>
  );
}
