import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { formatDate, formatUsd } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import { EmptyState, Panel, SkeletonTable } from '../../shared/ui/primitives';
import { IconReceipt } from '../../shared/ui/icons';

interface FeeRun {
  id: string;
  thresholdDays: number;
  runAt: string;
  chargedItemIds: string[];
  totalAmount: number;
  currency: string;
}

export function StorageFeesSection({ onError }: { onError: (m: string) => void }) {
  const { t, locale } = useI18n();
  const [runs, setRuns] = useState<FeeRun[] | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await api.get<FeeRun[]>('/admin/storage-fee-runs'));
    } catch (e) {
      onError((e as Error).message);
      setRuns([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <p className="infobox">{t('admin.storage.autoNotice')}</p>

      <Panel title={t('admin.storage.previousRuns', { count: runs?.length ?? 0 })}>
        {runs === null ? (
          <SkeletonTable rows={3} columns={4} />
        ) : runs.length === 0 ? (
          <EmptyState title={t('admin.storage.empty')} icon={<IconReceipt />} />
        ) : (
          <FeeStatement runs={runs} locale={locale} />
        )}
      </Panel>
    </>
  );
}

/**
 * The sweep's runs as a statement: a line to each, with its date and what it charged in all, and under that the
 * threshold it was run at and how many items it charged. Newest first, as the server lists them.
 */
function FeeStatement({ runs, locale }: { runs: FeeRun[]; locale: string }) {
  const { t } = useI18n();
  return (
    <div className="ledger-sheet fee-sheet">
      <ol className="fee-runs">
        {runs.map((run) => (
          <li key={run.id} className="fee-run">
            <span className="fee-run-date date">{formatDate(run.runAt, locale)}</span>
            <span className="fee-run-sum">
              <span className="money-label">{t('admin.storage.col.total')}</span>
              <span className="fee-run-total amount" dir="ltr">
                {formatUsd(run.totalAmount)}
              </span>
            </span>
            <span className="fee-run-meta">
              {t('admin.storage.col.thresholdDays')} {run.thresholdDays} ·{' '}
              {t('admin.storage.col.chargedItems')}{' '}
              {Array.isArray(run.chargedItemIds) ? run.chargedItemIds.length : 0}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
