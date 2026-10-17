import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import { navigate } from '../../../shared/routing';
import { Button, ErrorState, SuccessNote } from '../../../shared/ui/primitives';

/**
 * The page the verification link opens (`#/verify-email?token=…`).
 *
 * Verification runs on mount: the reader already expressed intent by clicking
 * the link in their mail.
 *
 * Three outcomes, each stated plainly. On failure the token is spent, expired
 * or wrong; an expired link is the common case and the only one with a way
 * forward, so a resend form is offered. The resend endpoint answers identically
 * for a known and an unknown address, so this page confirms the request without
 * claiming a mail was sent.
 */
type State =
  | { status: 'working' }
  | { status: 'verified' }
  | { status: 'failed'; message: string };

/**
 * One request per link.
 *
 * The token is single-use, and StrictMode runs the effect below twice in
 * development. A second request would be refused because the first spent the
 * link, and the page would say it failed, so a second run for the same token
 * waits on the first request. A failed one is dropped once it settles, so
 * coming back to the page later asks again.
 */
const verifying = new Map<string, Promise<unknown>>();

function verifyOnce(token: string): Promise<unknown> {
  const existing = verifying.get(token);
  if (existing) return existing;
  const request = api.post('/auth/verify-email', { token });
  verifying.set(token, request);
  request.catch(() => {
    if (verifying.get(token) === request) verifying.delete(token);
  });
  return request;
}

export function VerifyEmailPage({ token }: { token: string | null }) {
  const t = useT();
  /** The answer, and which link it is the answer for. */
  const [outcome, setOutcome] = useState<(State & { token: string }) | null>(null);
  const state: State = !token
    ? { status: 'failed', message: '' }
    : outcome?.token === token
      ? outcome
      : { status: 'working' };

  useEffect(() => {
    if (!token) return;
    // An answer that arrives after the page has moved on (unmounted, or opened
    // with another link) is about nothing on the screen.
    let live = true;
    verifyOnce(token).then(
      () => {
        if (live) setOutcome({ token, status: 'verified' });
      },
      (e: unknown) => {
        if (live) setOutcome({ token, status: 'failed', message: (e as Error).message });
      },
    );
    return () => {
      live = false;
    };
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
      setError((e as Error).message);
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
