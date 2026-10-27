import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { formatDateTime, formatDayHeading, formatTime } from '../../shared/money';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { EmptyState, Panel, SkeletonTable, StatusBadge, type StatusTone } from '../../shared/ui/primitives';
import { IconShield } from '../../shared/ui/icons';
import {
  attemptsByDay,
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
      <section className="ledger-sheet" aria-label={t('admin.signIns.title')}>
        <div className="ledger-cols ledger-cols--even">
          <dl className="ledger-col">
            <dt className="ledger-kicker">{t('admin.signIns.metric.successes')}</dt>
            <dd className="ledger-figure">
              <span className="amount" dir="ltr">
                {log ? log.last24h.successes : '—'}
              </span>
            </dd>
            <dd className="ledger-note">{t('admin.signIns.metric.window')}</dd>
          </dl>
          <dl className="ledger-col">
            <dt className="ledger-kicker">{t('admin.signIns.metric.failures')}</dt>
            <dd className="ledger-figure">
              <span className="amount" dir="ltr">
                {log ? log.last24h.failures : '—'}
              </span>
            </dd>
            <dd className="ledger-note">{t('admin.signIns.metric.addresses', { count: log?.last24h.failingAddresses ?? 0 })}</dd>
          </dl>
          <dl className="ledger-col">
            <dt className="ledger-kicker">{t('admin.signIns.metric.suspicious')}</dt>
            <dd className="ledger-figure">
              <span className="amount" dir="ltr">
                {log ? log.suspicious.length : '—'}
              </span>
            </dd>
            <dd className="ledger-note">{t('admin.signIns.metric.suspiciousNote')}</dd>
          </dl>
        </div>
      </section>

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
          <div className="register-days panel-body">
            {attemptsByDay(log.attempts).map(({ key, items, first }) => (
              <div key={key} className="register-day-group">
                <h3 className="register-day" id={`signins-${key}`}>
                  <span className="date">{formatDayHeading(first.occurredAt, locale)}</span>
                </h3>
                <ul className="timeline timeline--stamped timeline--log" aria-labelledby={`signins-${key}`}>
                  {items.map((a) => (
                    <li key={a.id}>
                      <span className="hint date">{formatTime(a.occurredAt, locale)}</span>
                      <div className="register-text">
                        <span className="register-kind">
                          <StatusBadge tone={OUTCOME_TONE[a.outcome]}>{t(OUTCOME_LABEL[a.outcome])}</StatusBadge>
                        </span>
                        <p className="register-entry">
                          <span className="ltr-run">{a.username ? `@${a.username}` : a.identifier}</span>
                          {!a.userId && <span className="hint"> · {t('admin.signIns.noAccount')}</span>}
                        </p>
                        <p className="register-meta">
                          <span className="code-inline" dir="ltr">
                            {displayIp(a.ip)}
                          </span>
                          {isLocalAddress(a.ip) && <span> · {t('admin.signIns.local')}</span>}
                          {' · '}
                          <span className="ltr-run" title={a.userAgent ?? undefined}>
                            {describeDevice(a.userAgent)}
                          </span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
