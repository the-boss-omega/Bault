import { useState, type ReactNode } from 'react';
import { LanguageSwitcher } from '../../../shared/ui/PageHeader';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { Serial } from '../../../shared/ui/Serial';
import { useI18n } from '../../../shared/i18n';
import { SignInPage } from './SignInPage';
import { SignUpPage } from './SignUpPage';
import { ForgotPasswordPage } from './ForgotPasswordPage';

/**
 * Who is signed in, as the shell needs them.
 *
 * There is no `displayName`: a person's name is the two explicit fields below,
 * and anywhere a single string is wanted the shell derives one with `fullName()`.
 * Both parts are optional here only because sign-in answers with the id and role
 * first and the profile request fills the rest in a moment later.
 */
export interface SessionUser {
  id: string;
  role: string;
  /** `active` or `suspended`; see `SessionProfile.status`. */
  status?: string;
  /** Filled in from /me/profile once the session is established. */
  email?: string;
  username?: string;
  firstName?: string | null;
  lastName?: string | null;
  /**
   * Two-factor sign-in. The sign-in response says `mfaEnrollmentRequired`
   * straight away; the profile then says `mfaRequired` and `mfaEnabled`. Either
   * way, an account whose role requires a second factor it has not enrolled is
   * refused by every route but enrolment, so the shell holds it on the
   * enrolment screen.
   */
  mfaEnrollmentRequired?: boolean;
  mfaRequired?: boolean;
  mfaEnabled?: boolean;
}


/**
 * The card on the landing stage: a seeded, catalogued item with its photograph
 * on disk under this exact serial. Named as constants so that if it is swapped,
 * the serial and the caption cannot fall out of step.
 */
export const LANDING_SERIAL = 'SN-DX107-0003';
export const LANDING_TITLE =
  '2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star) #107/107 · Rare Holo Star · art by Masakazu Fukuda · ex8-107';

/**
 * The signed-out chrome for the pages that take a password.
 *
 * The stage shows a real item Bault is holding, photographed, with its serial
 * and custody line, in the same photograph, serial component and custody green
 * the signed-in product uses. At ≥ 900px the stage and the form sit side by
 * side; below that the stage shrinks to a band above the form, because on a
 * phone the form is why anybody opened this.
 *
 * `bare` drops the stage, for the pages opened from an email (verify-email and
 * reset-password) and for forced two-factor enrolment.
 *
 * The language control is the shell's globe, in the same logical position it
 * occupies signed in. A language chooser has to be recognisable to somebody who
 * cannot read the page it is on, so it is an icon and not a word.
 */
export function AuthShell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const { t } = useI18n();

  return (
    <div className={bare ? 'auth-shell auth-shell--bare' : 'auth-shell'} data-density="marketing">
      {!bare && (
        <section className="auth-stage" aria-labelledby="auth-pitch">
          <div className="auth-stage-photo">
            {/*
              A real card, held by Bault, photographed. The serial is the
              filename, the same coupling the whole product runs on.
            */}
            <CardPhotoThumb serialNumber={LANDING_SERIAL} title={LANDING_TITLE} />
          </div>

          <div className="auth-pitch">
            <h1 className="auth-headline" id="auth-pitch">
              {t('auth.landing.headline')}
            </h1>
            <p className="auth-lede">{t('auth.landing.lede')}</p>

            {/* The custody line: what the platform actually knows about this
                object, in the components that state it everywhere else. */}
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

          {/* The same language control the signed-in shell uses. */}
          <LanguageSwitcher />
        </div>

        {children}
      </div>
    </div>
  );
}

/** Which form is on screen. Switched from inside, or opened directly on one. */
export type AuthMode = 'signIn' | 'signUp' | 'forgot';

/**
 * The signed-out entry point. Sign-in, sign-up and "forgot password" are
 * separate pages; this only decides which one is on screen, and each page owns
 * its own form and fields.
 *
 * `initialMode` exists because the landing page has two calls to action:
 * "Open an account" must arrive on the sign-up form. It is the starting mode
 * only; the links between the three forms still switch without a page load.
 */
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
