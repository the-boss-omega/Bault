import { useT } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/primitives';
import { TwoFactorPanel } from '../profile/TwoFactorPanel';
import { AuthShell } from './AuthPage';

/**
 * Where a member of staff whose role requires two-factor sign-in, and who has
 * not enrolled, is held.
 *
 * The API lets them sign in and then refuses every route except enrolment,
 * sign-out and their profile (`mfa_enrollment_required`), so the console would
 * be a screen of "forbidden" panels. This shows the one thing they can do, with
 * the way out beside it. Once the recovery codes are saved, `onEnrolled` lets
 * the shell load the console.
 */
export function ForcedEnrollmentPage({
  onEnrolled,
  onSignOut,
}: {
  onEnrolled: () => void;
  onSignOut: () => void;
}) {
  const t = useT();
  return (
    <AuthShell bare>
      <div className="stack auth-forced">
        <h2>{t('mfa.forced.title')}</h2>
        <p>{t('mfa.forced.body')}</p>
        <TwoFactorPanel onEnabled={onEnrolled} />
        <div className="row">
          <Button variant="ghost" onClick={onSignOut}>
            {t('app.logout')}
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
