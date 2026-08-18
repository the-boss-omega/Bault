import { useState, type ReactNode } from 'react';
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
 * The signed-out chrome: the Bault mark on a deep navy field, one white card,
 * and the language control.
 *
 * Extracted from `AuthPage` because it is no longer only sign-in and sign-up
 * that render outside the application shell. The email-verification and
 * password-reset pages are opened from a link in an email, by someone who by
 * definition has no session, and they need the same frame — including the
 * language control, since a reader who cannot read the page is exactly the
 * reader who needs to change language first. This is the only language control
 * in the product that is not the application shell's one.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const { t, toggleLocale } = useI18n();

  return (
    <div className="auth-shell">
      <div className="auth-box">
        <div className="auth-brand">
          <span className="rail-mark" aria-hidden="true">
            B
          </span>
          <span className="auth-brand-word">Bault</span>
        </div>

        {children}

        <div className="auth-lang">
          <button
            type="button"
            className="btn btn--sm"
            onClick={toggleLocale}
            aria-label={t('app.switchLanguageLabel')}
          >
            {t('app.switchLanguage')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The signed-out entry point. Sign-in, sign-up and "forgot password" remain
 * SEPARATE pages — this only decides which one is on screen, and each page owns
 * its own form and fields.
 */
export function AuthPage({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<'signIn' | 'signUp' | 'forgot'>('signIn');

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
