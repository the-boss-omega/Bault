import { useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { errorText } from '../../../shared/errors';
import { navigate } from '../../../shared/routing';
import { PASSWORD_MIN } from '../../../shared/names';
import { Button, ErrorState, Field, SuccessNote } from '../../../shared/ui/primitives';

/**
 * Step two of password recovery: the page the emailed link opens.
 *
 * The token arrives in the hash route (`#/reset-password?token=…`) and is never
 * shown, never editable and never stored — it goes straight from the URL into
 * the one request that consumes it. It is single-use and expires in an hour,
 * both enforced server-side, so this page's job is only to collect a new
 * password and report the outcome honestly.
 *
 * A missing token is its own state rather than a form that cannot succeed: the
 * usual cause is a mail client that truncated the link, and telling the reader
 * that is more useful than letting them type a password into a dead form.
 */
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
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <section className="auth-card">
        <h2>{t('auth.resetTitle')}</h2>
        <ErrorState message={t('auth.resetNoToken')} />
        <Button variant="gold" block onClick={goToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </section>
    );
  }

  if (done) {
    return (
      <section className="auth-card">
        <h2>{t('auth.resetTitle')}</h2>
        <SuccessNote>{t('auth.resetDone')}</SuccessNote>
        <Button variant="gold" block onClick={goToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </section>
    );
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h2>{t('auth.resetTitle')}</h2>
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

      <Button variant="gold" type="submit" block disabled={busy || !ready}>
        {t('auth.resetSubmit')}
      </Button>

      <p className="auth-switch">
        <button className="btn--link" type="button" onClick={goToSignIn}>
          {t('auth.backToSignIn')}
        </button>
      </p>
    </form>
  );
}
