import { useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { Button, ErrorState, SuccessNote } from '../../../shared/ui/primitives';
import { AuthCard } from './AuthCard';

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
      <AuthCard as="section" kicker={t('auth.kicker.forgot')} title={t('auth.forgotTitle')}>
        <SuccessNote>{t('auth.forgotSent', { email: email.trim() })}</SuccessNote>
        <p className="field-hint">{t('auth.forgotSentHint')}</p>
        <Button variant="primary" block onClick={onGoToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      kicker={t('auth.kicker.forgot')}
      title={t('auth.forgotTitle')}
      onSubmit={submit}
      stub={
        <p className="auth-switch">
          <Button variant="link" onClick={onGoToSignIn}>
            {t('auth.backToSignIn')}
          </Button>
        </p>
      }
    >
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

      <Button variant="primary" type="submit" block disabled={busy || !email.trim()}>
        {t('auth.forgotSubmit')}
      </Button>
    </AuthCard>
  );
}
