import { useT } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/primitives';
import { TwoFactorPanel } from '../profile/TwoFactorPanel';
import { AuthShell } from './AuthPage';

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
