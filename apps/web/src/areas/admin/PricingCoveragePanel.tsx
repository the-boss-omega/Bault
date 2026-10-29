import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { formatUsd } from '../../shared/money';
import { useI18n, type MessageKey, type TranslateFn } from '../../shared/i18n';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import { Code } from '../../shared/ui/Serial';
import {
  Button,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
  type StatusTone,
} from '../../shared/ui/primitives';
import { IconChevronRight, IconRefresh } from '../../shared/ui/icons';

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
    percentOf: string | null;
    rule: { model: string; value: number } | null;
  }[];
  unknownRules: { id: string; actionType: string }[];
}

export type CoverageStatus =
  'priced' | 'missing' | 'falls_back' | 'code_default' | 'free' | 'code_constant';

type Row = PricingCoverage['actions'][number];

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

/**
 * What a row says about whether a price is loaded, in the order that matters: what is missing makes an action
 * fail; what relies on a fallback or a default (or is free) is priced by something that is not its own rule;
 * what is priced is fine; what is fixed in the code needs no rule at all.
 */
type Group = 'missing' | 'fallback' | 'priced' | 'fixed';

const GROUP_OF: Record<CoverageStatus, Group> = {
  missing: 'missing',
  falls_back: 'fallback',
  code_default: 'fallback',
  free: 'fallback',
  priced: 'priced',
  code_constant: 'fixed',
};

const GROUP_LABEL: Record<Group, MessageKey> = {
  missing: 'admin.coverage.group.missing',
  fallback: 'admin.coverage.group.fallback',
  priced: 'admin.coverage.group.priced',
  fixed: 'admin.coverage.group.fixed',
};

function ruleValue(rule: { model: string; value: number }): string {
  return rule.model === 'percentage'
    ? `${Number((rule.value / 100).toFixed(2))}%`
    : formatUsd(rule.value);
}

/**
 * The check before launch, as a sheet: the verdict on paper, with how many of the actions have what they need
 * (a price of their own, or none to need) as its figure; beside it, what does not (what is missing makes an
 * action fail, and comes first); and what is fine folded away under it, to be opened. A list of every action
 * with its status was a list of thirty-five lines to read to find the one that was not.
 */
export function PricingCoveragePanel({
  refreshKey,
  onError,
  onLoaded,
}: {
  refreshKey: number;
  onError: (m: string) => void;
  onLoaded?: (coverage: PricingCoverage) => void;
}) {
  const { t } = useI18n();
  const [coverage, setCoverage] = useState<PricingCoverage | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.get<PricingCoverage>('/admin/pricing/coverage');
      setCoverage(next);
      onLoaded?.(next);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onError, onLoaded]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const byGroup = useMemo(() => {
    const groups: Record<Group, Row[]> = { missing: [], fallback: [], priced: [], fixed: [] };
    for (const row of coverage?.actions ?? []) groups[GROUP_OF[row.status]].push(row);
    for (const rows of Object.values(groups))
      rows.sort((a, b) => a.actionType.localeCompare(b.actionType));
    return groups;
  }, [coverage]);

  return (
    <Panel
      title={t('admin.coverage.title')}
      subtitle={t('admin.coverage.subtitle')}
      tools={
        <Button
          size="sm"
          variant="secondary"
          icon={<IconRefresh />}
          loading={loading}
          onClick={() => void load()}
        >
          {t('admin.coverage.check')}
        </Button>
      }
    >
      {coverage === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : (
        <div className="coverage">
          <aside className="coverage-sheet">
            <DrawerTag
              kicker={t('admin.coverage.kicker')}
              title={coverage.ready ? t('admin.coverage.ready') : t('admin.coverage.notReady')}
              amount={`${coverage.summary.priced + coverage.summary.codeConstant} / ${coverage.summary.total}`}
              lines={[
                { label: t('admin.coverage.line.priced'), value: coverage.summary.priced },
                { label: t('admin.coverage.line.fixed'), value: coverage.summary.codeConstant },
                { label: t('admin.coverage.line.missing'), value: coverage.summary.missing },
                {
                  label: t('admin.coverage.line.fallback'),
                  value:
                    coverage.summary.fallingBack +
                    coverage.summary.codeDefault +
                    coverage.summary.free,
                },
              ]}
              status={
                <StatusBadge tone={coverage.ready ? 'success' : 'error'}>
                  {coverage.ready
                    ? t('admin.coverage.state.ready')
                    : t('admin.coverage.state.notReady')}
                </StatusBadge>
              }
              note={t('admin.coverage.actionsNote', { total: coverage.summary.total })}
            />
          </aside>

          <div className="coverage-gaps">
            {byGroup.missing.length + byGroup.fallback.length === 0 ? (
              <SuccessNote>{t('admin.coverage.clear')}</SuccessNote>
            ) : (
              <div className="dt-wrap dt-wrap--stack">
                <table className="data-table data-table--coverage">
                  <thead>{coverageHead(t)}</thead>
                  {(['missing', 'fallback'] as const).map((group) =>
                    byGroup[group].length === 0 ? null : (
                      <tbody key={group} className="roll-group">
                        <tr className="roll-group-head">
                          <th scope="rowgroup" colSpan={4}>
                            <div className="roll-group-line">
                              <span className="roll-group-name">{t(GROUP_LABEL[group])}</span>
                              <span className="roll-group-count">{byGroup[group].length}</span>
                            </div>
                          </th>
                        </tr>
                        {byGroup[group].map((row) => (
                          <CoverageLine key={row.actionType} row={row} />
                        ))}
                      </tbody>
                    ),
                  )}
                </table>
              </div>
            )}

            {coverage.unknownRules.length > 0 && (
              <SuccessNote tone="warning">
                {t('admin.coverage.unknown')}{' '}
                {coverage.unknownRules.map((r) => (
                  <Code key={r.id} value={r.actionType} />
                ))}
              </SuccessNote>
            )}
          </div>

          <div className="coverage-rest">
            {(['priced', 'fixed'] as const).map((group) =>
              byGroup[group].length === 0 ? null : (
                <details key={group} className="coverage-fold">
                  <summary>
                    <IconChevronRight />
                    <span className="roll-group-name">{t(GROUP_LABEL[group])}</span>
                    <span className="roll-group-count">{byGroup[group].length}</span>
                  </summary>
                  <div className="dt-wrap dt-wrap--stack">
                    <table className="data-table data-table--coverage">
                      <thead>{coverageHead(t)}</thead>
                      <tbody>
                        {byGroup[group].map((row) => (
                          <CoverageLine key={row.actionType} row={row} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ),
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function coverageHead(t: TranslateFn) {
  return (
    <tr>
      <th scope="col">{t('admin.coverage.col.action')}</th>
      <th scope="col">{t('admin.coverage.col.status')}</th>
      <th scope="col" className="td-end">
        {t('admin.coverage.col.rule')}
      </th>
      <th scope="col">{t('admin.coverage.col.note')}</th>
    </tr>
  );
}

/** An action: its code, what it is priced by now (and, where it falls back, to what), its rule's figure, and what it is for. */
function CoverageLine({ row }: { row: Row }) {
  const { t } = useI18n();
  const alert = row.status === 'missing' || row.status === 'free';
  return (
    <tr className={alert ? 'is-alert' : row.status === 'priced' ? undefined : 'is-attention'}>
      <td data-label={t('admin.coverage.col.action')} className="coverage-cell--action">
        <code dir="ltr">{row.actionType}</code>
      </td>
      <td data-label={t('admin.coverage.col.status')} className="coverage-cell--status">
        <StatusBadge tone={STATUS_TONE[row.status]} plain>
          {t(STATUS_LABEL[row.status])}
        </StatusBadge>
        {row.status === 'falls_back' && row.fallsBackTo && (
          <span className="hint">
            {' '}
            → <code dir="ltr">{row.fallsBackTo}</code>
          </span>
        )}
      </td>
      <td data-label={t('admin.coverage.col.rule')} className="td-end num coverage-cell--rule">
        {row.rule ? ruleValue(row.rule) : '—'}
      </td>
      <td data-label={t('admin.coverage.col.note')} className="coverage-cell--note">
        <span className="hint" lang="en" dir="ltr">
          {row.description}
        </span>
      </td>
    </tr>
  );
}
