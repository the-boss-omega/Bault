import { useState, type ReactNode } from 'react';
import { LanguageSwitcher } from '../../../shared/ui/PageHeader';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { Serial } from '../../../shared/ui/Serial';
import { useI18n } from '../../../shared/i18n';
import { SignInPage } from './SignInPage';
import { SignUpPage } from './SignUpPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';

export interface SessionUser {
  id: string;
  role: string;
  status?: string;
  email?: string;
  username?: string;
  firstName?: string | null;
  lastName?: string | null;
  mfaEnrollmentRequired?: boolean;
  mfaRequired?: boolean;
  mfaEnabled?: boolean;
}


export const LANDING_SERIAL = 'SN-DX107-0003';
export const LANDING_TITLE =
  '2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star) #107/107 · Rare Holo Star · art by Masakazu Fukuda · ex8-107';

export function AuthShell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const { t } = useI18n();

  return (
    <div className={bare ? 'auth-shell auth-shell--bare' : 'auth-shell'} data-density="marketing">
      {!bare && (
        <section className="auth-stage" aria-labelledby="auth-pitch">
          <div className="auth-stage-photo">
            <CardPhotoThumb serialNumber={LANDING_SERIAL} title={LANDING_TITLE} />
          </div>

          <div className="auth-pitch">
            <h1 className="auth-headline" id="auth-pitch">
              {t('auth.landing.headline')}
            </h1>
            <p className="auth-lede">{t('auth.landing.lede')}</p>

            <dl className="auth-custody">
              <div>
                <dt>{t('vault.serial')}</dt>
                <dd>
                  <Serial value={LANDING_SERIAL} lead />
                </dd>
              </div>
              <div>
                <dt>{t('vault.item.state')}</dt>
                <dd>
                  <span className="pill pill--success">{t('auth.landing.state')}</span>
                </dd>
              </div>
              <div>
                <dt>{t('auth.landing.whereLabel')}</dt>
                <dd className="ltr-run">{t('auth.landing.where')}</dd>
              </div>
            </dl>

            <p className="auth-caption ltr-run">{LANDING_TITLE}</p>
          </div>
        </section>
      )}

      <div className="auth-box">
        <div className="auth-brand">
          <span className="rail-mark" aria-hidden="true">
            B
          </span>
          <span className="auth-brand-word">Bault</span>

          <LanguageSwitcher />
        </div>

        {children}
      </div>
    </div>
  );
}

export type AuthMode = 'signIn' | 'signUp' | 'forgot';

export function AuthPage({
  onSignedIn,
  initialMode = 'signIn',
}: {
  onSignedIn: (user: SessionUser) => void;
  initialMode?: AuthMode;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);

  return (
    <AuthShell>
      {mode === 'signIn' && (
        <SignInPage
          onSignedIn={onSignedIn}
          onGoToSignUp={() => setMode('signUp')}
          onGoToForgotPassword={() => setMode('forgot')}
        />
      )}
      {mode === 'signUp' && <SignUpPage onGoToSignIn={() => setMode('signIn')} />}
      {mode === 'forgot' && <ForgotPasswordPage onGoToSignIn={() => setMode('signIn')} />}
    </AuthShell>
  );
}
