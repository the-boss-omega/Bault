import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const { YieldChart } = await import('../../apps/web/src/areas/admin/YieldChart');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const ROWS = [
  { label: 'A', revenueMinor: 5300, perSlotMonthMinor: null, occupied: 3, shelves: 4 },
  { label: 'B', revenueMinor: 2650, perSlotMonthMinor: null, occupied: 2, shelves: 4 },
];

function chart(locale: 'en' | 'he') {
  localStorage.setItem('bault.locale', locale);
  return render(
    <I18nProvider>
      <YieldChart rows={ROWS} title="Yield" subtitle="Per zone" />
    </I18nProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('the yield chart reads from the end its axis starts at', () => {
  it('draws its bars from the left in English, where $0.00 is at the left', () => {
    const { container } = chart('en');

    const bars = container.querySelector('svg g');
    expect(bars).not.toHaveAttribute('transform');
    expect(bars).toHaveAttribute('data-from', 'start');
    const widths = Array.from(container.querySelectorAll('rect')).map((r) => Number(r.getAttribute('width')));
    expect(widths).toEqual([100, 50]);
  });

  it('draws them from the right in Hebrew, where $0.00 is at the right', () => {
    const { container } = chart('he');

    const bars = container.querySelector('svg g');
    // Mirrored across the 100-wide drawing, so a bar that starts at x = 0 starts at the right-hand end.
    expect(bars).toHaveAttribute('transform', 'translate(100 0) scale(-1 1)');
    expect(bars).toHaveAttribute('data-from', 'end');
    // The proportions are the same.
    const widths = Array.from(container.querySelectorAll('rect')).map((r) => Number(r.getAttribute('width')));
    expect(widths).toEqual([100, 50]);
    // The axis starts with the zero, which in Hebrew is the right-hand end of the line.
    const axis = container.querySelector('.chart-axis')!;
    expect(axis.firstElementChild).toHaveTextContent('$0.00');
  });
});
