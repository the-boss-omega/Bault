import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type TranslateFn } from '../../shared/i18n';
import { itemName } from '../../shared/itemClasses';
import { Button, EmptyState, ErrorState, Panel, SkeletonTable } from '../../shared/ui/primitives';
import { IconBox } from '../../shared/ui/icons';
import { RelocateBench, type BenchShelf } from './Benches';
import { ListSearch, NoMatch, matchesQuery } from './ListTools';

export interface ToShelveRow {
  itemId: string;
  serialNumber: string;
  barcode: string;
  description: string;
  typeClass: string;
  oversized: boolean;
  lifecycleState: string;
  parcelCode: string | null;
  ownerUsername: string | null;
  reason: string | null;
  placementUndecidedAt: string;
  waitingSeconds: number;
}

export function waitedFor(t: TranslateFn, seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return t('warehouse.toShelve.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('warehouse.toShelve.hours', { count: hours });
  return t('warehouse.toShelve.days', { count: Math.floor(hours / 24) });
}

export function ToShelvePanel({
  shelves,
  onLog,
  onDone,
}: {
  shelves: readonly BenchShelf[];
  onLog: (line: string) => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ToShelveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ToShelveRow | null>(null);
  const [q, setQ] = useState('');
  const shown = (rows ?? []).filter((r) =>
    matchesQuery(q, r.serialNumber, r.barcode, r.description, r.parcelCode, r.ownerUsername, r.reason),
  );

  const load = useCallback(async () => {
    try {
      const list = await api.get<ToShelveRow[]>('/custody/to-shelve');
      setRows(list);
      setError(null);
      setChosen((current) => (current && list.some((r) => r.itemId === current.itemId) ? current : null));
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stowed = useCallback(async () => {
    await load();
    await onDone();
  }, [load, onDone]);

  return (
    <Panel id="to-shelve" title={t('warehouse.toShelve.title')} subtitle={t('warehouse.toShelve.subtitle')} flush>
      {error ? (
        <ErrorState
          title={t('warehouse.toShelve.loadFailed')}
          message={error}
          onRetry={() => void load()}
          retryLabel={t('ui.retry')}
        />
      ) : rows === null ? (
        <SkeletonTable rows={3} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('warehouse.toShelve.empty')} text={t('warehouse.toShelve.emptyText')} icon={<IconBox />} />
      ) : (
        <div className="stack stack--tight">
          <ListSearch
            value={q}
            onChange={setQ}
            label={t('warehouse.toShelve.search')}
            placeholder={t('warehouse.toShelve.searchPlaceholder')}
            shown={shown.length}
            total={rows.length}
          />
          {shown.length === 0 && <NoMatch onClear={() => setQ('')} />}
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('warehouse.toShelve.col.item')}</th>
                  <th scope="col">{t('warehouse.toShelve.col.parcel')}</th>
                  <th scope="col">{t('warehouse.toShelve.col.owner')}</th>
                  <th scope="col">{t('warehouse.toShelve.col.reason')}</th>
                  <th scope="col" className="td-end">
                    {t('warehouse.toShelve.col.waiting')}
                  </th>
                  <th scope="col" className="td-tight" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.itemId}>
                    <td data-label={t('warehouse.toShelve.col.item')}>
                      <span className="dt-primary">
                        <code dir="ltr">{row.serialNumber}</code>
                      </span>
                      <span className="hint" dir="auto">
                        {' '}
                        {itemName(t, row)}
                      </span>
                    </td>
                    <td data-label={t('warehouse.toShelve.col.parcel')}>
                      {row.parcelCode ? <code dir="ltr">{row.parcelCode}</code> : '—'}
                    </td>
                    <td data-label={t('warehouse.toShelve.col.owner')}>
                      {row.ownerUsername ? <bdi dir="ltr">@{row.ownerUsername}</bdi> : '—'}
                    </td>
                    <td data-label={t('warehouse.toShelve.col.reason')} dir="auto">
                      {row.reason ?? '—'}
                    </td>
                    <td data-label={t('warehouse.toShelve.col.waiting')} className="td-end num">
                      {waitedFor(t, row.waitingSeconds)}
                    </td>
                    <td className="td-tight">
                      <Button
                        size="sm"
                        variant={chosen?.itemId === row.itemId ? 'primary' : 'secondary'}
                        pressed={chosen?.itemId === row.itemId}
                        aria-label={t('warehouse.toShelve.stowItem', { serial: row.serialNumber })}
                        onClick={() => setChosen(row)}
                      >
                        {t('warehouse.toShelve.stow')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {chosen && (
            <div className="panel-body">
              <RelocateBench
                key={chosen.itemId}
                initialItem={chosen.serialNumber}
                shelves={shelves}
                onLog={onLog}
                onDone={stowed}
              />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
