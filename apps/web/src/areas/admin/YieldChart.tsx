import { useId } from 'react';
import { useI18n } from '../../shared/i18n';
import { formatUsd } from '../../shared/money';

/**
 * Revenue against the space it consumed, per zone.
 *
 * The one chart style in this product, and the reason it exists is that the
 * management console had none: it answered "which zone pays for itself" with
 * three tables of numbers and a progress bar in a cell whose scale was never
 * stated, so `$225.00` and `$75.00` produced bars nobody could read against
 * anything.
 *
 * THE RULES THIS CHART FOLLOWS, and every future chart with it:
 *
 *   · Graphite bars, ONE accent. The accent marks the thing being acted on —
 *     here, the zone earning least per shelf-month — and nothing else is
 *     coloured. A chart where every series has its own hue is a chart where the
 *     hues mean nothing.
 *   · Tabular axis labels, and the axis states its maximum. A bar chart without
 *     a stated scale is a decoration.
 *   · No gradients, no drop shadows, no rounded caps, no animation on load.
 *   · Every bar carries its own figure. The bar is for comparing down a column;
 *     the number is for knowing. Neither replaces the other.
 *   · The SVG is `aria-hidden`. It draws the bars and nothing else — every
 *     label, figure and occupancy count beside it is ordinary text at the page's
 *     own size, so a screen reader gets the whole chart as prose and a browser's
 *     text zoom works on it. There is no text inside the viewBox to be scaled
 *     into the wrong size by it.
 *
 * The measure is a RATIO where one is available — what came in, against how much
 * shelf it took to earn it — because a zone can be the biggest earner and the
 * worst use of space at the same time, and that is the thing worth seeing.
 */

export interface YieldBar {
  /** The zone, as an operator says it: `NJ / A`. */
  label: string;
  /** Everything the zone earned, in minor units. */
  revenueMinor: number;
  /** What that works out to per occupied shelf per month. Null while empty. */
  perSlotMonthMinor: number | null;
  /** Occupied shelves, which is the space the revenue cost. */
  occupied: number;
  shelves: number;
}

export function YieldChart({ rows, title, subtitle }: { rows: readonly YieldBar[]; title: string; subtitle: string }) {
  const { t } = useI18n();
  const captionId = useId();

  /**
   * What is actually plotted, and it is not always the same measure.
   *
   * Revenue per shelf-month is the better question — it is a ratio, and it is
   * what tells a manager which part of the building pays for itself. But it is
   * undefined until occupancy has accrued: a facility seeded or opened this
   * morning has zero shelf-days, so every zone reports `null` and a chart drawn
   * against it is a row of empty bars under an axis that reads $0.00 to $0.01.
   *
   * So the chart falls back to plain REVENUE, which is always true and always
   * available, and the axis says which of the two it is showing. A chart that
   * quietly changes what it measures would be worse than either; a chart that
   * renders nothing because the ratio is not ready yet would be worse still.
   */
  const perSlot = rows.some((r) => r.perSlotMonthMinor !== null);
  const measure = (row: YieldBar) => (perSlot ? (row.perSlotMonthMinor ?? 0) : row.revenueMinor);
  const max = Math.max(1, ...rows.map(measure));
  /**
   * The zone returning least is the one to act on, and the only coloured bar.
   *
   * An EMPTY zone is excluded. A zone with nothing on its shelves returns
   * nothing by arithmetic rather than by underperforming, and marking it would
   * point a manager at the one row where there is no decision to make — while
   * hiding the row where there is.
   */
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

      {/*
        `viewBox` with `preserveAspectRatio` off the horizontal axis: the bars
        scale with the container while the row height stays fixed, so a zone list
        does not get taller on a wide screen.
      */}
      <svg
        className="chart-svg"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        height={height}
        aria-hidden="true"
        focusable="false"
      >
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
      </svg>

      {/* The labels and figures sit outside the SVG, so they are real text at
          the page's own size rather than glyphs scaled by a viewBox. */}
      <div className="chart-rows" style={{ '--chart-label': `${labelWidth}px`, '--chart-value': `${valueWidth}px` } as React.CSSProperties}>
        {rows.map((row) => (
          <div className="chart-row" key={row.label} style={{ height: rowHeight }}>
            {/* Occupancy is the DENOMINATOR of this chart, so it sits with the
                zone's name rather than floating over the bar — where, at the
                widths a zone list actually renders at, it landed on top of it
                and neither could be read. */}
            <span className="chart-label">
              <span className="ltr-run">{row.label}</span>
              <span className="chart-note">
                {t('yield.chart.occupancy', { occupied: row.occupied, shelves: row.shelves, count: row.shelves })}
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
