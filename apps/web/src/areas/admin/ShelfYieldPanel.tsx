import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { formatUsd } from '../../shared/money';
import {
  EmptyState,
  ErrorState,
  MetricCard,
  Panel,
  SkeletonTable,
  StatusBadge,
} from '../../shared/ui/primitives';
import { IconAlert, IconBox, IconLocation } from '../../shared/ui/icons';
import { YieldChart } from './YieldChart';

/**
 * Shelf Yield — what a shelf earns against the occupancy it consumes.
 *
 * The operator half of the engine behind Break-Even Watch. The design problem this
 * screen solves is that a yield table is a wall of numbers, and the job a person
 * brings to it is not "read the numbers" — it is **find the worst shelf**. So
 * the worst shelf is at the top, every row carries a bar as well as a figure so
 * the comparison happens by looking rather than by reading, and the two things
 * that need acting on (dead items, long-idle stock) are called out rather than
 * left to be inferred from a column.
 *
 * The headline says REVENUE, never profit. Bault's rent, labour and insurance
 * are not in this database, and a margin computed without them would be a
 * confident number about something nobody measured.
 */

interface ShelfRow {
  binId: string;
  serialNumber: string;
  zone: string;
  facilityCode: string | null;
  oversized: boolean;
  active: boolean;
  itemCount: number;
  slotDays: number;
  revenueMinor: number;
  revenuePerSlotMonthMinor: number | null;
  deadItemCount: number;
  oldestItemDays: number | null;
}

interface ZoneRow {
  zone: string;
  shelfCount: number;
  occupiedShelfCount: number;
  itemCount: number;
  deadItemCount: number;
  revenueMinor: number;
  revenuePerSlotMonthMinor: number | null;
}

interface CustomerRow {
  userId: string;
  username: string;
  itemCount: number;
  slotDays: number;
  revenueMinor: number;
  revenuePerSlotMonthMinor: number | null;
  deadItemCount: number;
}

interface Yield {
  shelves: ShelfRow[];
  totals: {
    shelfCount: number;
    occupiedShelfCount: number;
    emptyShelfCount: number;
    itemCount: number;
    deadItemCount: number;
    revenueMinor: number;
    slotDays: number;
  };
}

/**
 * A figure and its bar.
 *
 * The bar is scaled against the best performer on screen rather than an
 * absolute maximum: the question is always "which of these is worst", and a
 * bar scaled to a number nobody has reached would flatten every row into the
 * same short stub.
 */
function YieldCell({ value, best }: { value: number | null; best: number }) {
  const { t } = useI18n();
  if (value === null) {
    return <span className="hint">{t('yield.noYield')}</span>;
  }
  const pct = best > 0 ? Math.max(2, Math.round((value / best) * 100)) : 0;
  return (
    <span className="yield-cell">
      <span className="num">{formatUsd(value)}</span>
      <span className={`yield-bar${value === 0 ? ' yield-bar--dead' : ''}`} aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export function ShelfYieldPanel() {
  const { t } = useI18n();
  const [data, setData] = useState<Yield | null>(null);
  const [zones, setZones] = useState<ZoneRow[] | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [shelves, z, c] = await Promise.all([
        api.get<Yield>('/admin/shelf-yield'),
        api.get<ZoneRow[]>('/admin/shelf-yield/zones'),
        api.get<CustomerRow[]>('/admin/shelf-yield/customers'),
      ]);
      setData(shelves);
      setZones(z);
      setCustomers(c);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />;
  }

  const occupied = (data?.shelves ?? []).filter((s) => s.itemCount > 0);
  const bestShelf = Math.max(0, ...occupied.map((s) => s.revenuePerSlotMonthMinor ?? 0));
  const bestZone = Math.max(0, ...(zones ?? []).map((z) => z.revenuePerSlotMonthMinor ?? 0));
  const bestCustomer = Math.max(0, ...(customers ?? []).map((c) => c.revenuePerSlotMonthMinor ?? 0));

  return (
    <>
      {/* The four numbers that decide whether to act, before any table. */}
      <div className="metric-grid">
        <MetricCard
          label={t('yield.metric.revenue')}
          value={data ? formatUsd(data.totals.revenueMinor) : '—'}
          icon={<IconBox />}
          tone="green"
          footer={t('yield.metric.revenueNote')}
        />
        <MetricCard
          label={t('yield.metric.occupied')}
          value={data ? `${data.totals.occupiedShelfCount} / ${data.totals.shelfCount}` : '—'}
          icon={<IconLocation />}
          tone="blue"
          footer={t('yield.metric.emptyShelves', { count: data?.totals.emptyShelfCount ?? 0 })}
        />
        <MetricCard
          label={t('yield.metric.dead')}
          value={data?.totals.deadItemCount ?? '—'}
          icon={<IconAlert />}
          tone="amber"
          footer={t('yield.metric.deadNote')}
        />
        <MetricCard
          label={t('yield.metric.slotDays')}
          value={data ? data.totals.slotDays.toLocaleString() : '—'}
          icon={<IconBox />}
          tone="violet"
          footer={t('yield.metric.slotDaysNote')}
        />
      </div>

      <Panel title={t('yield.shelves.title')} subtitle={t('yield.shelves.subtitle')} flush>
        {data === null ? (
          <SkeletonTable rows={6} columns={5} />
        ) : occupied.length === 0 ? (
          <EmptyState
            title={t('yield.shelves.empty')}
            text={t('yield.shelves.emptyText')}
            icon={<IconLocation />}
          />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('yield.col.shelf')}</th>
                  <th scope="col">{t('yield.col.zone')}</th>
                  <th scope="col" className="td-end">
                    {t('yield.col.items')}
                  </th>
                  <th scope="col" className="td-end">
                    {t('yield.col.revenue')}
                  </th>
                  <th scope="col">{t('yield.col.perSlotMonth')}</th>
                  <th scope="col">{t('yield.col.flag')}</th>
                </tr>
              </thead>
              <tbody>
                {occupied.map((s) => (
                  <tr key={s.binId}>
                    <td data-label={t('yield.col.shelf')}>
                      <span className="dt-primary mono" dir="ltr">
                        {s.serialNumber}
                      </span>
                    </td>
                    <td data-label={t('yield.col.zone')}>
                      {s.zone}
                      {s.facilityCode && <span className="dt-sub">{s.facilityCode}</span>}
                    </td>
                    <td data-label={t('yield.col.items')} className="td-end num">
                      {s.itemCount}
                    </td>
                    <td data-label={t('yield.col.revenue')} className="td-end num">
                      {formatUsd(s.revenueMinor)}
                    </td>
                    <td data-label={t('yield.col.perSlotMonth')}>
                      <YieldCell value={s.revenuePerSlotMonthMinor} best={bestShelf} />
                    </td>
                    <td data-label={t('yield.col.flag')}>
                      {s.deadItemCount > 0 ? (
                        <StatusBadge tone="warning">
                          {t('yield.flag.dead', { count: s.deadItemCount })}
                        </StatusBadge>
                      ) : s.oldestItemDays !== null && s.oldestItemDays > 180 ? (
                        <StatusBadge tone="neutral">
                          {t('yield.flag.idle', { days: s.oldestItemDays })}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="success">{t('yield.flag.earning')}</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t('yield.zones.title')} subtitle={t('yield.zones.subtitle')} flush>
        {/*
          The question this screen exists to answer — which part of the building
          pays for itself — was being asked of three tables of numbers and a
          progress bar in a cell whose scale was never stated. One chart, in the
          product's only chart style: graphite bars, one accent on the zone
          earning least per shelf-month, tabular labels, a stated maximum.

          It sits ABOVE the table rather than replacing it. The chart answers
          "which one", the table answers "by how much", and they are different
          questions.
        */}
        {zones !== null && zones.length > 0 && (
          <div className="panel-note">
            <YieldChart
              // The title names what is plotted: the ratio once occupancy has
              // accrued, plain revenue until then (see YieldChart).
              title={
                zones.some((z) => z.revenuePerSlotMonthMinor !== null)
                  ? t('yield.chart.title')
                  : t('yield.chart.titleRevenue')
              }
              subtitle={t('yield.chart.subtitle')}
              rows={zones.map((z) => ({
                label: z.zone,
                revenueMinor: z.revenueMinor,
                perSlotMonthMinor: z.revenuePerSlotMonthMinor,
                occupied: z.occupiedShelfCount,
                shelves: z.shelfCount,
              }))}
            />
          </div>
        )}

        {zones === null ? (
          <SkeletonTable rows={3} columns={4} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('yield.col.zone')}</th>
                  <th scope="col" className="td-end">
                    {t('yield.col.shelves')}
                  </th>
                  <th scope="col" className="td-end">
                    {t('yield.col.items')}
                  </th>
                  <th scope="col" className="td-end">
                    {t('yield.col.revenue')}
                  </th>
                  <th scope="col">{t('yield.col.perSlotMonth')}</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.zone}>
                    <td data-label={t('yield.col.zone')}>
                      <span className="dt-primary">{z.zone}</span>
                    </td>
                    <td data-label={t('yield.col.shelves')} className="td-end num">
                      {z.occupiedShelfCount} / {z.shelfCount}
                    </td>
                    <td data-label={t('yield.col.items')} className="td-end num">
                      {z.itemCount}
                    </td>
                    <td data-label={t('yield.col.revenue')} className="td-end num">
                      {formatUsd(z.revenueMinor)}
                    </td>
                    <td data-label={t('yield.col.perSlotMonth')}>
                      {/* Zones are scaled against the best ZONE, not the best shelf. */}
                      <YieldCell value={z.revenuePerSlotMonthMinor} best={bestZone} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t('yield.customers.title')} subtitle={t('yield.customers.subtitle')} flush>
        {customers === null ? (
          <SkeletonTable rows={4} columns={4} />
        ) : customers.length === 0 ? (
          <EmptyState title={t('yield.customers.empty')} text="" icon={<IconBox />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('yield.col.customer')}</th>
                  <th scope="col" className="td-end">
                    {t('yield.col.items')}
                  </th>
                  <th scope="col" className="td-end">
                    {t('yield.col.revenue')}
                  </th>
                  <th scope="col">{t('yield.col.perSlotMonth')}</th>
                  <th scope="col">{t('yield.col.flag')}</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.userId}>
                    <td data-label={t('yield.col.customer')}>
                      <span className="dt-primary mono" dir="ltr">
                        @{c.username}
                      </span>
                    </td>
                    <td data-label={t('yield.col.items')} className="td-end num">
                      {c.itemCount}
                    </td>
                    <td data-label={t('yield.col.revenue')} className="td-end num">
                      {formatUsd(c.revenueMinor)}
                    </td>
                    <td data-label={t('yield.col.perSlotMonth')}>
                      <YieldCell value={c.revenuePerSlotMonthMinor} best={bestCustomer} />
                    </td>
                    <td data-label={t('yield.col.flag')}>
                      {c.deadItemCount > 0 ? (
                        <StatusBadge tone="warning">
                          {t('yield.flag.dead', { count: c.deadItemCount })}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="success">{t('yield.flag.earning')}</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="panel-note">
          {t('yield.customers.footnote')}
        </p>
      </Panel>
    </>
  );
}
