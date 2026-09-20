import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { formatDateTime } from '../../shared/money';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { Button, EmptyState, MetricCard, Panel, SkeletonTable, StatusBadge, type StatusTone } from '../../shared/ui/primitives';
import { IconAlert, IconShield, IconUser } from '../../shared/ui/icons';
import {
  describeDevice,
  displayIp,
  isLocalAddress,
  type SignInLog,
  type SignInOutcome,
} from '../../shared/signIns';

const OUTCOME_TONE: Record<SignInOutcome, StatusTone> = {
  success: 'success',
  bad_credentials: 'error',
  unverified: 'warning',
  refused: 'error',
};

const OUTCOME_LABEL: Record<SignInOutcome, MessageKey> = {
  success: 'admin.signIns.outcome.success',
  bad_credentials: 'admin.signIns.outcome.bad_credentials',
  unverified: 'admin.signIns.outcome.unverified',
  refused: 'admin.signIns.outcome.refused',
};

/**
 * Who signed in, and who tried to.
 *
 * Until `login_attempt` existed this screen could not have been built: a failed
 * sign-in was not recorded anywhere, and a successful one was an audit row with
 * the user left empty. The question an administrator most needs answered —
 * *is somebody guessing passwords?* — had the answer "we would never know".
 *
 * The figures come first because they are what decides whether to read the
 * table at all. The `suspicious` list is the pattern pulled out of the rows —
 * five or more failures against one identifier in a day — so it is not left to
 * somebody scanning two hundred lines for a repeat.
 *
 * The identifier is what was TYPED, so a burst against an address that has no
 * account shows up as clearly as one against an address that does. The password
 * is not in this log, in any form.
 */
const PAGE = 50;

export function SignInsSection({ onError }: { onError: (m: string) => void }) {
  const { t, locale } = useI18n();
  const [log, setLog] = useState<SignInLog | null>(null);
  /** Fifty at a time: the full log was one 23,000px page on a phone. */
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    try {
      setLog(await api.get<SignInLog>('/admin/logins'));
    } catch (e) {
      onError((e as Error).message);
      setLog({ since: '', last24h: { successes: 0, failures: 0, failingAddresses: 0 }, suspicious: [], attempts: [] });
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="metric-grid">
        <MetricCard
          label={t('admin.signIns.metric.successes')}
          value={log ? log.last24h.successes : '—'}
          icon={<IconUser />}
          tone="green"
          footer={t('admin.signIns.metric.window')}
        />
        <MetricCard
          label={t('admin.signIns.metric.failures')}
          value={log ? log.last24h.failures : '—'}
          icon={<IconAlert />}
          tone="amber"
          footer={t('admin.signIns.metric.addresses', { count: log?.last24h.failingAddresses ?? 0 })}
        />
        <MetricCard
          label={t('admin.signIns.metric.suspicious')}
          value={log ? log.suspicious.length : '—'}
          icon={<IconShield />}
          tone="violet"
          footer={t('admin.signIns.metric.suspiciousNote')}
        />
      </div>

      {log && log.suspicious.length > 0 && (
        <Panel title={t('admin.signIns.suspicious.title')} subtitle={t('admin.signIns.suspicious.subtitle')} flush>
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.signIns.col.identifier')}</th>
                  <th scope="col" className="td-end">
                    {t('admin.signIns.col.failures')}
                  </th>
                  <th scope="col" className="td-end">
                    {t('admin.signIns.col.addresses')}
                  </th>
                  <th scope="col">{t('admin.signIns.col.last')}</th>
                </tr>
              </thead>
              <tbody>
                {log.suspicious.map((s) => (
                  <tr key={s.identifier} className="is-alert">
                    <td data-label={t('admin.signIns.col.identifier')}>
                      <span className="ltr-run">{s.identifier}</span>
                    </td>
                    <td data-label={t('admin.signIns.col.failures')} className="td-end num">
                      {s.failures}
                    </td>
                    <td data-label={t('admin.signIns.col.addresses')} className="td-end num">
                      {s.addresses}
                    </td>
                    <td data-label={t('admin.signIns.col.last')}>
                      <span dir="ltr">{formatDateTime(s.lastAt, locale)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title={t('admin.signIns.title')} subtitle={t('admin.signIns.subtitle')} flush>
        {log === null ? (
          <SkeletonTable rows={5} columns={5} />
        ) : log.attempts.length === 0 ? (
          <EmptyState title={t('admin.signIns.empty')} icon={<IconShield />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.signIns.col.when')}</th>
                  <th scope="col">{t('admin.signIns.col.outcome')}</th>
                  <th scope="col">{t('admin.signIns.col.account')}</th>
                  <th scope="col">{t('admin.signIns.col.address')}</th>
                  <th scope="col">{t('admin.signIns.col.device')}</th>
                </tr>
              </thead>
              <tbody>
                {log.attempts.slice(0, shown).map((a) => (
                  <tr key={a.id} className={a.outcome === 'success' ? undefined : 'is-attention'}>
                    <td data-label={t('admin.signIns.col.when')}>
                      <span dir="ltr">{formatDateTime(a.occurredAt, locale)}</span>
                    </td>
                    <td data-label={t('admin.signIns.col.outcome')}>
                      <StatusBadge tone={OUTCOME_TONE[a.outcome]}>{t(OUTCOME_LABEL[a.outcome])}</StatusBadge>
                    </td>
                    <td data-label={t('admin.signIns.col.account')}>
                      {/* The account it resolved to — or, when it resolved to
                          nothing, exactly what was typed, so a stranger's guess
                          is as visible as a member's typo. */}
                      <span className="ltr-run">{a.username ? `@${a.username}` : a.identifier}</span>
                      {!a.userId && <span className="hint"> · {t('admin.signIns.noAccount')}</span>}
                    </td>
                    <td data-label={t('admin.signIns.col.address')}>
                      <span className="code-inline" dir="ltr">
                        {displayIp(a.ip)}
                      </span>
                      {isLocalAddress(a.ip) && <span className="hint"> · {t('admin.signIns.local')}</span>}
                    </td>
                    <td data-label={t('admin.signIns.col.device')}>
                      <span className="ltr-run" title={a.userAgent ?? undefined}>
                        {describeDevice(a.userAgent)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {log.attempts.length > shown && (
              <div className="row" style={{ padding: 'var(--sp-4)', justifyContent: 'center' }}>
                <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
                  {t('admin.signIns.showMore', { count: Math.min(PAGE, log.attempts.length - shown) })}
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </>
  );
}
