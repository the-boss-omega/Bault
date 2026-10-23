import { useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { Button, ErrorState, SuccessNote } from '../../../shared/ui/primitives';

export function ForgotPasswordPage({ onGoToSignIn }: { onGoToSignIn: () => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/reset-request', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="auth-card">
        <h2>{t('auth.forgotTitle')}</h2>
        <SuccessNote>{t('auth.forgotSent', { email: email.trim() })}</SuccessNote>
        <p className="field-hint">{t('auth.forgotSentHint')}</p>
        <Button variant="gold" block onClick={onGoToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </section>
    );
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h2>{t('auth.forgotTitle')}</h2>
      <p className="field-hint">{t('auth.forgotIntro')}</p>

      <label className="field">
        <span className="field-label">{t('auth.email')}</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          dir="ltr"
        />
      </label>

      {error && <ErrorState message={error} />}

      <Button variant="gold" type="submit" block disabled={busy || !email.trim()}>
        {t('auth.forgotSubmit')}
      </Button>

      <p className="auth-switch">
        <button className="btn--link" type="button" onClick={onGoToSignIn}>
          {t('auth.backToSignIn')}
        </button>
      </p>
    </form>
  );
}
