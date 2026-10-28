import { useEffect, useState } from 'react';
import { ApiError, api, apiErrorKey } from '../../../shared/api';
import { useT, type TranslateFn } from '../../../shared/i18n';
import { navigate } from '../../../shared/routing';
import { Button, ErrorState, SuccessNote } from '../../../shared/ui/primitives';

type State =
  | { status: 'working' }
  | { status: 'verified' }
  | { status: 'failed'; error: unknown };

const verifying = new Map<string, Promise<unknown>>();

function failure(t: TranslateFn, e: unknown): string {
  if (e instanceof ApiError && e.status === 410) return t('auth.verifyLinkInvalid');
  const key = apiErrorKey(e);
  return key ? t(key) : (e as Error).message;
}

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
  const [outcome, setOutcome] = useState<(State & { token: string }) | null>(null);
  const state: State = !token
    ? { status: 'failed', error: null }
    : outcome?.token === token
      ? outcome
      : { status: 'working' };

  useEffect(() => {
    if (!token) return;
    let live = true;
    verifyOnce(token).then(
      () => {
        if (live) setOutcome({ token, status: 'verified' });
      },
      (e: unknown) => {
        if (live) setOutcome({ token, status: 'failed', error: e });
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
        <Button variant="primary" block onClick={goToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <h2>{t('auth.verifyTitle')}</h2>
      <ErrorState message={token ? failure(t, state.error) : t('auth.verifyNoToken')} />
      <p className="field-hint">{t('auth.verifyFailedHint')}</p>
      <ResendForm />
      <p className="auth-switch">
        <Button variant="link" onClick={goToSignIn}>
          {t('auth.backToSignIn')}
        </Button>
      </p>
    </section>
  );
}

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
