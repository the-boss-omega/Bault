import { useId } from 'react';
import { useI18n } from '../../shared/i18n';
import { formatUsd } from '../../shared/money';

export interface YieldBar {
  label: string;
  revenueMinor: number;
  perSlotMonthMinor: number | null;
  occupied: number;
  shelves: number;
}

export function YieldChart({ rows, title, subtitle }: { rows: readonly YieldBar[]; title: string; subtitle: string }) {
  const { t, locale } = useI18n();
  const captionId = useId();
  // The bars grow from the end the axis starts at ($0), which is the right-hand end when read from the right.
  const fromRight = locale === 'he';

  const perSlot = rows.some((r) => r.perSlotMonthMinor !== null);
  const measure = (row: YieldBar) => (perSlot ? (row.perSlotMonthMinor ?? 0) : row.revenueMinor);
  const max = Math.max(1, ...rows.map(measure));
  const worst = rows
    .filter((r) => r.occupied > 0)
    .reduce<YieldBar | null>((low, r) => (low === null || measure(r) < measure(low) ? r : low), null);

  const rowHeight = 40;
  const height = rows.length * rowHeight;
  const labelWidth = 132;
  const valueWidth = 92;

  return (
    <figure className="chart" aria-labelledby={captionId}>
      <figcaption id={captionId} className="chart-caption">
        <span className="chart-title">{title}</span>
        <span className="chart-sub">{subtitle}</span>
      </figcaption>

      <svg
        className="chart-svg"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        height={height}
        aria-hidden="true"
        focusable="false"
      >
        <g transform={fromRight ? 'translate(100 0) scale(-1 1)' : undefined} data-from={fromRight ? 'end' : 'start'}>
          {rows.map((row, index) => {
            const value = measure(row);
            const width = (value / max) * 100;
            const y = index * rowHeight + (rowHeight - 12) / 2;
            return (
              <rect
                key={row.label}
                x={0}
                y={y}
                width={Math.max(width, value > 0 ? 0.6 : 0)}
                height={12}
                className={row.label === worst?.label ? 'chart-bar chart-bar--mark' : 'chart-bar'}
              />
            );
          })}
        </g>
      </svg>

      <div className="chart-rows" style={{ '--chart-label': `${labelWidth}px`, '--chart-value': `${valueWidth}px` } as React.CSSProperties}>
        {rows.map((row) => (
          <div className="chart-row" key={row.label} style={{ height: rowHeight }}>
            <span className="chart-label">
              <span className="ltr-run">{row.label}</span>
              <span className="chart-note">
                {t('yield.chart.occupancy', { occupied: row.occupied, shelves: row.shelves })}
              </span>
            </span>
            <span className="chart-value amount">{formatUsd(measure(row))}</span>
          </div>
        ))}
      </div>

      <p className="chart-axis">
        <span className="amount">{formatUsd(0)}</span>
        <span className="chart-axis-label">
          {perSlot ? t('yield.col.perSlotMonth') : t('yield.chart.revenueAxis')}
        </span>
        <span className="amount">{formatUsd(max)}</span>
      </p>
    </figure>
  );
}
