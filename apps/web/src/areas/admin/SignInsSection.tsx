import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { formatDateTime } from '../../shared/money';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { EmptyState, MetricCard, Panel, SkeletonTable, StatusBadge, type StatusTone } from '../../shared/ui/primitives';
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
  mfa_challenged: 'info',
  mfa_failed: 'error',
};

const OUTCOME_LABEL: Record<SignInOutcome, MessageKey> = {
  success: 'admin.signIns.outcome.success',
  bad_credentials: 'admin.signIns.outcome.bad_credentials',
  unverified: 'admin.signIns.outcome.unverified',
  refused: 'admin.signIns.outcome.refused',
  mfa_challenged: 'admin.signIns.outcome.mfa_challenged',
  mfa_failed: 'admin.signIns.outcome.mfa_failed',
};

const ROUTINE: ReadonlySet<SignInOutcome> = new Set(['success', 'mfa_challenged']);

export function SignInsSection({ onError }: { onError: (m: string) => void }) {
  const { t, locale } = useI18n();
  const [log, setLog] = useState<SignInLog | null>(null);

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
                      <span className="date">{formatDateTime(s.lastAt, locale)}</span>
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
                {log.attempts.map((a) => (
                  <tr key={a.id} className={ROUTINE.has(a.outcome) ? undefined : 'is-attention'}>
                    <td data-label={t('admin.signIns.col.when')}>
                      <span className="date">{formatDateTime(a.occurredAt, locale)}</span>
                    </td>
                    <td data-label={t('admin.signIns.col.outcome')}>
                      <StatusBadge tone={OUTCOME_TONE[a.outcome]}>{t(OUTCOME_LABEL[a.outcome])}</StatusBadge>
                    </td>
                    <td data-label={t('admin.signIns.col.account')}>
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
          </div>
        )}
      </Panel>
    </>
  );
}
