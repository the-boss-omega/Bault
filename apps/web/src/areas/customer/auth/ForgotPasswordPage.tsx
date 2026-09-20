import { useState, type FormEvent } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { errorText } from '../../../shared/errors';
import { Button, ErrorState, SuccessNote } from '../../../shared/ui/primitives';

/**
 * Step one of password recovery: ask for the reset link.
 *
 * The API answers identically whether or not the address belongs to an account
 * — `VerificationService.issuePasswordReset` returns silently for an unknown
 * email — so this page must do the same. It shows one confirmation for every
 * submission and never says "no such account", because a form that distinguishes
 * the two is an account-enumeration oracle: anyone could test an address list
 * against it.
 *
 * That is also why the confirmation is worded as what WILL happen if the
 * address is registered, rather than asserting that a mail was sent.
 */
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
      // Only a transport or validation failure reaches here; an unknown address
      // is a success as far as this endpoint is concerned.
      setError(errorText(t, err));
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
