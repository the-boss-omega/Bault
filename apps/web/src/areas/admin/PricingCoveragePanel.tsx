import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { formatUsd } from '../../shared/money';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { Button, Panel, SkeletonTable, StatusBadge, type StatusTone } from '../../shared/ui/primitives';
import { IconRefresh } from '../../shared/ui/icons';

/** `GET /admin/pricing/coverage` — see `apps/api/src/modules/prc/billable-actions.ts`. */
export interface PricingCoverage {
  ready: boolean;
  summary: {
    total: number;
    priced: number;
    missing: number;
    fallingBack: number;
    codeDefault: number;
    free: number;
    codeConstant: number;
  };
  actions: {
    actionType: string;
    resolution: string;
    fallsBackTo: string | null;
    status: CoverageStatus;
    description: string;
    rule: { model: string; value: number } | null;
  }[];
  unknownRules: { id: string; actionType: string }[];
}

type CoverageStatus = 'priced' | 'missing' | 'falls_back' | 'code_default' | 'free' | 'code_constant';

const STATUS_TONE: Record<CoverageStatus, StatusTone> = {
  priced: 'success',
  missing: 'error',
  falls_back: 'warning',
  code_default: 'warning',
  free: 'error',
  code_constant: 'neutral',
};

const STATUS_LABEL: Record<CoverageStatus, MessageKey> = {
  priced: 'admin.coverage.status.priced',
  missing: 'admin.coverage.status.missing',
  falls_back: 'admin.coverage.status.falls_back',
  code_default: 'admin.coverage.status.code_default',
  free: 'admin.coverage.status.free',
  code_constant: 'admin.coverage.status.code_constant',
};

/** A rule's value as a person reads it: cents for a fixed rule, basis points for a percentage. */
function ruleValue(rule: { model: string; value: number }): string {
  return rule.model === 'percentage' ? `${Number((rule.value / 100).toFixed(2))}%` : formatUsd(rule.value);
}

/**
 * Is every price loaded? (E6)
 *
 * No migration inserts a pricing rule, so a database built for production
 * from migrations alone cannot price an intake, and several actions fall back
 * quietly — to another rule, to a figure in the code, or to nothing. This is
 * the launch check: every action the code charges for, what it costs right
 * now, and what happens to the ones that have no rule. Problems sort first.
 */
export function PricingCoveragePanel({ refreshKey, onError }: { refreshKey: number; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [coverage, setCoverage] = useState<PricingCoverage | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCoverage(await api.get<PricingCoverage>('/admin/pricing/coverage'));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const order: CoverageStatus[] = ['missing', 'free', 'falls_back', 'code_default', 'priced', 'code_constant'];
  const rows = coverage
    ? [...coverage.actions].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
    : [];

  return (
    <Panel
      title={t('admin.coverage.title')}
      subtitle={t('admin.coverage.subtitle')}
      tools={
        <Button size="sm" variant="secondary" icon={<IconRefresh />} loading={loading} onClick={() => void load()}>
          {t('admin.coverage.check')}
        </Button>
      }
      flush
    >
      {coverage === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : (
        <>
          <p className="panel-body">
            <StatusBadge tone={coverage.ready ? 'success' : 'error'}>
              {coverage.ready ? t('admin.coverage.ready') : t('admin.coverage.notReady')}
            </StatusBadge>{' '}
            {t('admin.coverage.summary', {
              total: coverage.summary.total,
              priced: coverage.summary.priced,
              missing: coverage.summary.missing,
              other: coverage.summary.fallingBack + coverage.summary.codeDefault + coverage.summary.free,
            })}
          </p>
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.coverage.col.action')}</th>
                  <th scope="col">{t('admin.coverage.col.status')}</th>
                  <th scope="col" className="td-end">
                    {t('admin.coverage.col.rule')}
                  </th>
                  <th scope="col">{t('admin.coverage.col.note')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.actionType} className={a.status === 'missing' || a.status === 'free' ? 'is-alert' : undefined}>
                    <td data-label={t('admin.coverage.col.action')}>
                      <code dir="ltr">{a.actionType}</code>
                    </td>
                    <td data-label={t('admin.coverage.col.status')}>
                      <StatusBadge tone={STATUS_TONE[a.status]} plain>
                        {t(STATUS_LABEL[a.status])}
                      </StatusBadge>
                      {a.status === 'falls_back' && a.fallsBackTo && (
                        <span className="hint">
                          {' '}
                          → <code dir="ltr">{a.fallsBackTo}</code>
                        </span>
                      )}
                    </td>
                    <td data-label={t('admin.coverage.col.rule')} className="td-end num">
                      {a.rule ? ruleValue(a.rule) : '—'}
                    </td>
                    <td data-label={t('admin.coverage.col.note')}>
                      <span className="hint" lang="en" dir="ltr">
                        {a.description}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {coverage.unknownRules.length > 0 && (
            <p className="panel-body hint">
              {t('admin.coverage.unknown')}{' '}
              {coverage.unknownRules.map((r) => (
                <code key={r.id} dir="ltr">
                  {r.actionType}{' '}
                </code>
              ))}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
