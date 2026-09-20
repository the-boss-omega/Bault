import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { errorText } from '../../../shared/errors';
import { navigate } from '../../../shared/routing';
import { Button, ErrorState, SuccessNote } from '../../../shared/ui/primitives';

/**
 * The page the verification link opens (`#/verify-email?token=…`).
 *
 * Verification runs on mount rather than behind a button: the reader already
 * expressed intent by clicking the link in their mail, and asking them to
 * confirm a second time is a step that carries no information.
 *
 * Three outcomes, each stated plainly. On failure the token is spent, expired
 * or wrong — an expired link is the common case and the only one with a way
 * forward, so a resend form is offered rather than a dead end. The resend
 * endpoint answers identically for a known and an unknown address, so this
 * page confirms the request without claiming a mail was sent.
 */
type State =
  | { status: 'working' }
  | { status: 'verified' }
  | { status: 'failed'; message: string };

export function VerifyEmailPage({ token }: { token: string | null }) {
  const t = useT();
  const [state, setState] = useState<State>(
    token ? { status: 'working' } : { status: 'failed', message: '' },
  );

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        await api.post('/auth/verify-email', { token });
        setState({ status: 'verified' });
      } catch (e) {
        setState({ status: 'failed', message: (e as Error).message });
      }
    })();
  }, [token]);

  function goToSignIn() {
    navigate({ section: '' }, { replace: true });
  }

  if (state.status === 'working') {
    return (
      <section className="auth-card">
        <h2>{t('auth.verifyTitle')}</h2>
        <p className="field-hint">{t('auth.verifyWorking')}</p>
      </section>
    );
  }

  if (state.status === 'verified') {
    return (
      <section className="auth-card">
        <h2>{t('auth.verifyTitle')}</h2>
        <SuccessNote>{t('auth.verifyDone')}</SuccessNote>
        <Button variant="gold" block onClick={goToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <h2>{t('auth.verifyTitle')}</h2>
      <ErrorState message={token ? state.message : t('auth.verifyNoToken')} />
      <p className="field-hint">{t('auth.verifyFailedHint')}</p>
      <ResendForm />
      <p className="auth-switch">
        <button className="btn--link" type="button" onClick={goToSignIn}>
          {t('auth.backToSignIn')}
        </button>
      </p>
    </section>
  );
}

/**
 * Ask for a fresh verification link. Shared shape with the sign-up page's own
 * resend control, but this one collects the address because the reader arrived
 * from a link rather than from having just typed it.
 */
function ResendForm() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/verify-email/resend', { email: email.trim() });
      setSent(true);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <SuccessNote>{t('auth.verifyResent')}</SuccessNote>;

  return (
    <>
      <label className="field">
        <span className="field-label">{t('auth.email')}</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          dir="ltr"
        />
      </label>
      {error && <ErrorState message={error} />}
      <Button variant="secondary" block disabled={busy || !email.trim()} onClick={() => void resend()}>
        {t('auth.verifyResend')}
      </Button>
    </>
  );
}
