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
  /** `active` or `suspended` — see `SessionProfile.status`. */
  status?: string;
  /** Filled in from /me/profile once the session is established. */
  email?: string;
  username?: string;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * The card on the landing stage.
 *
 * A seeded, catalogued item with its photograph on disk under this exact
 * serial — the Gold Star, which is the collection's centrepiece and the most
 * valuable thing in the demo vault. Named as constants rather than inlined so
 * that if it is ever swapped, the serial and the caption cannot fall out of step
 * with each other and start describing a different card than the one on screen.
 */
export const LANDING_SERIAL = 'SN-DX107-0003';
export const LANDING_TITLE =
  '2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star) #107/107 · Rare Holo Star · art by Masakazu Fukuda · ex8-107';

/**
 * The signed-out chrome for the pages that take a password.
 *
 * There IS a marketing page now — `marketing/LandingPage.tsx`, which anonymous
 * visitors meet first — but this screen was the whole public face of the product
 * for a long time, and the reason it looks the way it does still holds. It was a
 * 440px white card floating on a navy radial gradient with a gold `B` above it
 * and a paragraph of demo credentials underneath — a login box, doing the job of
 * a shop window.
 *
 * It is a shop window now, and it is built out of the same argument the product
 * makes everywhere else: A REAL ITEM, PHOTOGRAPHED, WITH ITS SERIAL AND ITS
 * CUSTODY LINE. Not an illustration of a vault door, not a stock photograph of
 * somebody smiling at a laptop — the actual thing Bault is holding, lit on the
 * photography stage, with the record beside it. The image is the pitch, and it
 * is the same photograph, the same serial component and the same custody green
 * that the signed-in product uses, because a landing page that promises a
 * different product than the one behind it is a lie told twice.
 *
 * At ≥ 900px the stage and the form sit side by side; below that the stage
 * shrinks to a band above the form, because on a phone the form is why anybody
 * opened this.
 *
 * `bare` drops the stage for the pages that are opened FROM AN EMAIL —
 * verify-email and reset-password. Somebody who has clicked a link to confirm an
 * address is not being sold anything; they want one sentence and a button.
 *
 * The language control is the shell's globe, in the same logical position it
 * occupies signed in. A language chooser is the one control that has to be
 * recognisable to somebody who cannot read the page it is on, which is an icon
 * and not a word.
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
              filename — the same coupling the whole product runs on — so this
              cannot drift into being a picture of nothing.
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

          {/*
            THE SAME LANGUAGE CONTROL THE REST OF THE PRODUCT USES.

            This was a text button that printed the name of the OTHER language:
            "English" on the Hebrew page, and "עברית" on the English one — a
            Hebrew word sitting on the sign-in screen of an English build, which
            reads as a stray label rather than as a way to change anything. It
            also toggled between exactly two languages, so it could never grow a
            third without becoming a lie.

            `LanguageSwitcher` is a globe with a menu that names every language in
            its own script and marks the current one. It is what the signed-in
            shell has always used, and a language chooser is the one control that
            has to be recognisable to somebody who cannot read the page it is on —
            which is an icon, not a word.
          */}
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
 * The signed-out entry point. Sign-in, sign-up and "forgot password" remain
 * SEPARATE pages — this only decides which one is on screen, and each page owns
 * its own form and fields.
 *
 * `initialMode` exists because the landing page has two calls to action and they
 * mean different things: "Open an account" must arrive on the sign-up form, and
 * arriving on the sign-in form with a link underneath is asking somebody to make
 * the same choice twice. It is the STARTING mode only — the links between the
 * three forms still work as they always did, so a visitor who guessed wrong is
 * one click from the right one and never a page load.
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
