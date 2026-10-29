import { useId, type CSSProperties } from 'react';
import { useI18n } from '../../shared/i18n';
import { formatUsd } from '../../shared/money';

export interface YieldBar {
  label: string;
  revenueMinor: number;
  perSlotMonthMinor: number | null;
  occupied: number;
  shelves: number;
}

/**
 * Round steps from zero to a ceiling that holds the largest value, in whole dollars (0 / 20 / 40 / 60): the scale
 * the bars are drawn to, so that the longest does not run to the edge and the zero is where a bar begins.
 */
export function niceTicks(maxMinor: number, want = 4): number[] {
  const top = Math.max(maxMinor, 1);
  const rough = top / want;
  const power = Math.max(100, 10 ** Math.floor(Math.log10(rough)));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? power * 10;
  const count = Math.max(1, Math.ceil(top / step));
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

/** A tick on the axis, short: $0, $20, $1.5K. */
export function formatTick(minor: number): string {
  const dollars = minor / 100;
  if (dollars < 1000) return `$${dollars}`;
  return `$${Number((dollars / 1000).toFixed(1))}K`;
}

const props = (values: Record<string, number>) => values as unknown as CSSProperties;

/**
 * What each zone earns, as bars from a zero they all begin at: the worst first (the one worth looking at is the
 * one at the top), each with its value at the end of its bar and what it is made of (how many of its shelves are
 * occupied) at its start, the weakest of the zones that are occupied marked in the amber and in words, and a
 * scale of round steps under them. Every value is written beside its bar, so the table under the chart is its
 * twin and nothing is behind a hover. It reads from the end its zero is at: from the right, in Hebrew.
 */
export function YieldChart({
  rows,
  title,
  subtitle,
}: {
  rows: readonly YieldBar[];
  title: string;
  subtitle: string;
}) {
  const { t } = useI18n();
  const captionId = useId();

  const perSlot = rows.some((r) => r.perSlotMonthMinor !== null);
  const measure = (row: YieldBar) => (perSlot ? (row.perSlotMonthMinor ?? 0) : row.revenueMinor);
  const largest = Math.max(0, ...rows.map(measure));
  // Where nothing has been earned there is nothing to compare: the table has the zeros.
  if (largest <= 0) return null;

  const ticks = niceTicks(largest);
  const scale = ticks[ticks.length - 1]!;
  // The zones that earn, from the least up (that is the order to look in), then those with nothing on their shelves.
  const ranked = [...rows].sort(
    (a, b) => Number(b.occupied > 0) - Number(a.occupied > 0) || measure(a) - measure(b),
  );
  const occupied = ranked.filter((r) => r.occupied > 0);
  // One zone is not "the lowest" of anything, and neither is one of several that earn the same.
  const lowest =
    occupied.length > 0 && measure(occupied[0]!) < measure(occupied[occupied.length - 1]!)
      ? occupied[0]!
      : null;

  return (
    <figure className="chart" aria-labelledby={captionId}>
      <figcaption id={captionId} className="chart-caption">
        <span className="chart-title">{title}</span>
        <span className="chart-sub">{subtitle}</span>
      </figcaption>

      <ul className="chart-rows" style={props({ '--steps': ticks.length - 1 })}>
        {ranked.map((row) => {
          const ratio = measure(row) / scale;
          const marked = row === lowest;
          return (
            <li className="chart-row" key={row.label}>
              <span className="chart-label">
                <span className="ltr-run">{row.label}</span>
                <span className="chart-note">
                  {t('yield.chart.occupancy', { occupied: row.occupied, shelves: row.shelves })}
                </span>
              </span>
              <span className="chart-track" style={props({ '--ratio': ratio })}>
                <span
                  className={marked ? 'chart-bar chart-bar--mark' : 'chart-bar'}
                  aria-hidden="true"
                />
                <span className="chart-value">
                  <span className="amount">{formatUsd(measure(row))}</span>
                  {marked && (
                    <span className="chart-flag">
                      <span className="chart-flag-key" aria-hidden="true" />
                      {t('yield.chart.lowest')}
                    </span>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="chart-axis" aria-hidden="true">
        <span className="chart-ticks">
          {ticks.map((tick) => (
            // The tick is placed by the page's direction and its figure is read left to right: two elements.
            <span key={tick} className="chart-tick" style={props({ '--at': tick / scale })}>
              <span dir="ltr">{formatTick(tick)}</span>
            </span>
          ))}
        </span>
      </div>
      <p className="chart-axis-label">
        {perSlot ? t('yield.col.perSlotMonth') : t('yield.chart.revenueAxis')}
      </p>
    </figure>
  );
}
