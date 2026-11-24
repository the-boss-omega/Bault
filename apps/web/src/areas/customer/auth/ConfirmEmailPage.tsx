import { useEffect, useState } from 'react';
import { ApiError, api, apiErrorKey } from '../../../shared/api';
import { useT, type TranslateFn } from '../../../shared/i18n';
import { navigate } from '../../../shared/routing';
import { Button, ErrorState, SuccessNote } from '../../../shared/ui/primitives';
import { AuthCard } from './AuthCard';

type State = { status: 'working' } | { status: 'confirmed' } | { status: 'failed'; error: unknown };

const confirming = new Map<string, Promise<unknown>>();

function failure(t: TranslateFn, e: unknown): string {
  if (e instanceof ApiError && e.status === 410) return t('auth.confirmEmailInvalid');
  const key = apiErrorKey(e);
  return key ? t(key) : (e as Error).message;
}

function confirmOnce(token: string): Promise<unknown> {
  const existing = confirming.get(token);
  if (existing) return existing;
  const request = api.post('/auth/email/confirm', { token });
  confirming.set(token, request);
  request.catch(() => {
    if (confirming.get(token) === request) confirming.delete(token);
  });
  return request;
}

export function ConfirmEmailPage({ token }: { token: string | null }) {
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
    confirmOnce(token).then(
      () => {
        if (live) setOutcome({ token, status: 'confirmed' });
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
    navigate({ section: 'signin' }, { replace: true });
  }

  if (state.status === 'working') {
    return (
      <AuthCard as="section" kicker={t('auth.kicker.confirmEmail')} title={t('auth.confirmEmailTitle')}>
        <p className="field-hint">{t('auth.verifyWorking')}</p>
      </AuthCard>
    );
  }

  if (state.status === 'confirmed') {
    return (
      <AuthCard as="section" kicker={t('auth.kicker.confirmEmail')} title={t('auth.confirmEmailTitle')}>
        <SuccessNote>{t('auth.confirmEmailDone')}</SuccessNote>
        <Button variant="primary" block onClick={goToSignIn}>
          {t('auth.goToSignIn')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      as="section"
      kicker={t('auth.kicker.confirmEmail')}
      title={t('auth.confirmEmailTitle')}
      stub={
        <p className="auth-switch">
          <Button variant="link" onClick={goToSignIn}>
            {t('auth.backToSignIn')}
          </Button>
        </p>
      }
    >
      <ErrorState message={token ? failure(t, state.error) : t('auth.verifyNoToken')} />
    </AuthCard>
  );
}
