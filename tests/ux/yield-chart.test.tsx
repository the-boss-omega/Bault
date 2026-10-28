import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { YieldChart, niceTicks, formatTick } =
  await import('../../apps/web/src/areas/admin/YieldChart');
const { ShelfYieldPanel } = await import('../../apps/web/src/areas/admin/ShelfYieldPanel');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
};

/**
 * The yield chart: what each zone earns, as bars from a zero they all begin at (worst first, the weakest of the
 * zones that earn marked in the amber and in words, every value written beside its bar, a scale of round steps
 * under them), reading from the end its zero is at.
 */
const SRC = join(__dirname, '..', '..', 'apps', 'web', 'src');
const CSS = [
  'index',
  'theme',
  'slab',
  'components',
  'buttons',
  'landing',
  'app',
  'gallery',
  'screens',
  'motion',
]
  .map((name) => readFileSync(join(SRC, `${name}.css`), 'utf8'))
  .join('\n');
const BROWSER = '/opt/pw-browsers/chromium';

let browser: Browser | null = null;
try {
  browser = await chromium.launch(
    existsSync(BROWSER) ? { executablePath: BROWSER } : { channel: 'chrome' },
  );
} catch {
  browser = null;
}
afterAll(async () => {
  await browser?.close();
});

type Locale = 'en' | 'he';

async function inBrowser(width: number, locale: Locale, theme: 'dark' | 'light'): Promise<Page> {
  const html = document.body.innerHTML;
  const context = await browser!.newContext({
    viewport: { width, height: 900 },
    reducedMotion: 'reduce',
    hasTouch: width < 800,
    isMobile: width < 800,
  });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html lang="${locale}" dir="${locale === 'he' ? 'rtl' : 'ltr'}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bault</title><style>${CSS}</style></head><body>${html}</body></html>`,
  );
  return page;
}

const ZONES = [
  { label: 'NJ / A', revenueMinor: 184000, perSlotMonthMinor: 46000, occupied: 4, shelves: 4 },
  { label: 'NJ / B', revenueMinor: 52500, perSlotMonthMinor: 17500, occupied: 3, shelves: 4 },
  { label: 'NJ / O', revenueMinor: 0, perSlotMonthMinor: null, occupied: 0, shelves: 2 },
  { label: 'TA / V', revenueMinor: 241000, perSlotMonthMinor: 120500, occupied: 2, shelves: 2 },
];

function chart(locale: Locale, rows = ZONES) {
  localStorage.setItem('bault.locale', locale);
  return render(
    <I18nProvider>
      <YieldChart rows={rows} title="Yield" subtitle="Per zone" />
    </I18nProvider>,
  );
}

const rowsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.chart-row')) as HTMLElement[];
const nameOf = (row: HTMLElement) => row.querySelector('.chart-label .ltr-run')?.textContent;

beforeEach(() => {
  localStorage.clear();
  get.mockReset();
});

describe('the scale: round steps from a zero', () => {
  it('goes from zero in whole-dollar steps to a ceiling that holds the largest value', () => {
    expect(niceTicks(5300)).toEqual([0, 2000, 4000, 6000]);
    expect(niceTicks(120500)).toEqual([0, 50000, 100000, 150000]);
    expect(niceTicks(9000)).toEqual([0, 5000, 10000]);
    expect(niceTicks(46000)).toEqual([0, 20000, 40000, 60000]);
    // The ceiling is never below the largest value, and a step is never a fraction of a dollar.
    for (const value of [1, 50, 99, 100, 101, 999, 5300, 12345, 99999, 4_500_000]) {
      const ticks = niceTicks(value);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(value);
      for (const tick of ticks) expect(tick % 100).toBe(0);
      expect(ticks.length).toBeLessThanOrEqual(7);
    }
    // Nothing earned is still a scale, though no chart is drawn from it.
    expect(niceTicks(0)).toEqual([0, 100]);
  });

  it('writes a step short: $0, $20, $999, $1.5K, $10K', () => {
    expect(formatTick(0)).toBe('$0');
    expect(formatTick(2000)).toBe('$20');
    expect(formatTick(99900)).toBe('$999');
    expect(formatTick(150000)).toBe('$1.5K');
    expect(formatTick(100000)).toBe('$1K');
    expect(formatTick(1000000)).toBe('$10K');
  });
});

describe('the chart, as a list of zones', () => {
  it('is named by its title, and is a list a screen reader reads a zone at a time', () => {
    const { container } = chart('en');
    const figure = screen.getByRole('figure', { name: /Yield/ });
    expect(figure).toBeInTheDocument();
    const list = container.querySelector('ul.chart-rows')!;
    const first = list.querySelector('li')!;
    // Its name, what it is made of and what it earns, in the order they are read.
    expect(first).toHaveTextContent('NJ / B3 of 4 shelves occupied$175.00');
  });

  it('lists the worst first, the zones that earn from the least up and those with nothing on their shelves last', () => {
    const { container } = chart('en');
    expect(rowsOf(container).map(nameOf)).toEqual(['NJ / B', 'NJ / A', 'TA / V', 'NJ / O']);
  });

  it('writes every value at the end of its bar, so that the table beneath it is its twin and nothing is behind a hover', () => {
    const { container } = chart('en');
    const values = rowsOf(container).map(
      (r) => r.querySelector('.chart-value .amount')?.textContent,
    );
    expect(values).toEqual(['$175.00', '$460.00', '$1,205.00', '$0.00']);
    expect(container.querySelectorAll('[title], [role="tooltip"]')).toHaveLength(0);
  });

  it('draws each bar to the scale, from zero: a bar is its value over the ceiling of the axis', () => {
    const { container } = chart('en');
    // Per slot-month: the largest is 1,205.00 and the ceiling of the axis is 1,500.00.
    const ratios = rowsOf(container).map((r) =>
      Number((r.querySelector('.chart-track') as HTMLElement).style.getPropertyValue('--ratio')),
    );
    expect(ratios.map((r) => Number(r.toFixed(3)))).toEqual([0.117, 0.307, 0.803, 0]);
    expect(Math.max(...ratios)).toBeLessThan(1);
  });

  it('marks the weakest of the zones that earn, in a colour and in a word, and no other', () => {
    const { container } = chart('en');
    const marked = container.querySelectorAll('.chart-bar--mark');
    expect(marked).toHaveLength(1);
    const row = marked[0]!.closest('.chart-row') as HTMLElement;
    expect(nameOf(row)).toBe('NJ / B');
    // The word is in the text's own ink: colour is not the only way it says so.
    expect(within(row).getByText('Lowest')).toBeInTheDocument();
    expect(container.querySelectorAll('.chart-flag')).toHaveLength(1);
  });

  it('does not mark one of the zones as the lowest where they earn the same, or where there is only the one', () => {
    const same = ZONES.map((z) => ({ ...z, perSlotMonthMinor: z.occupied ? 30000 : null }));
    const { container, unmount } = chart('en', same);
    expect(container.querySelectorAll('.chart-bar--mark')).toHaveLength(0);
    expect(screen.queryByText('Lowest')).toBeNull();
    unmount();
    const one = chart('en', [ZONES[0]!, ZONES[2]!]);
    expect(one.container.querySelectorAll('.chart-bar--mark')).toHaveLength(0);
    expect(screen.queryByText('Lowest')).toBeNull();
  });

  it('measures revenue where no zone has accrued any time yet, and says that it does', () => {
    const noTime = ZONES.map((z) => ({ ...z, perSlotMonthMinor: null }));
    const { container } = chart('en', noTime);
    expect(container.querySelector('.chart-axis-label')).toHaveTextContent(
      'Revenue (no occupancy accrued yet)',
    );
    // 525.00, 1,840.00 and 2,410.00: the weakest earner is NJ / B.
    expect(rowsOf(container).map(nameOf)).toEqual(['NJ / B', 'NJ / A', 'TA / V', 'NJ / O']);
    expect(rowsOf(container)[0]!.querySelector('.amount')).toHaveTextContent('$525.00');
    // Per slot-month, the axis says so.
    const { container: perSlot } = chart('en');
    expect(perSlot.querySelectorAll('.chart-axis-label')[0]).toHaveTextContent('Per slot-month');
  });

  it('has a scale of round steps that starts with the zero, which no reader of it hears', () => {
    const { container } = chart('en');
    const axis = container.querySelector('.chart-axis')!;
    expect(axis).toHaveAttribute('aria-hidden', 'true');
    expect(Array.from(axis.querySelectorAll('.chart-tick')).map((t) => t.textContent)).toEqual([
      '$0',
      '$500',
      '$1K',
      '$1.5K',
    ]);
    // Zero first: in Hebrew that is the right-hand end of the line, where the bars begin.
    for (const t of Array.from(axis.querySelectorAll('.chart-tick'))) {
      // The tick is placed by the page's direction, and the figure in it is read left to right.
      expect(t).not.toHaveAttribute('dir');
      expect(t.querySelector('[dir="ltr"]')).not.toBeNull();
    }
  });

  it('is not drawn where nothing has been earned: a chart of nothing says nothing the table does not', () => {
    const none = ZONES.map((z) => ({ ...z, revenueMinor: 0, perSlotMonthMinor: null }));
    const { container } = chart('en', none);
    expect(container.querySelector('.chart')).toBeNull();
  });

  it('says the same in Hebrew, with the names of the zones kept left to right', () => {
    const { container } = chart('he');
    expect(rowsOf(container).map(nameOf)).toEqual(['NJ / B', 'NJ / A', 'TA / V', 'NJ / O']);
    expect(container.querySelector('.chart-flag')).toHaveTextContent('הנמוך ביותר');
    expect(container.querySelector('.chart-note')).toHaveTextContent('3 מתוך 4 מדפים תפוסים');
    expect(container.querySelector('.chart-label .ltr-run')).toHaveClass('ltr-run');
  });
});

describe('the chart on the page of the shelf yield', () => {
  it('is level with the tables it is among, and is the twin of the zone table under it', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/admin/shelf-yield')
        return {
          shelves: [],
          totals: {
            shelfCount: 0,
            occupiedShelfCount: 0,
            emptyShelfCount: 0,
            itemCount: 0,
            deadItemCount: 0,
            revenueMinor: 0,
            slotDays: 0,
          },
        };
      if (path === '/admin/shelf-yield/zones')
        return ZONES.map((z) => ({
          zone: z.label,
          shelfCount: z.shelves,
          occupiedShelfCount: z.occupied,
          itemCount: 1,
          deadItemCount: 0,
          revenueMinor: z.revenueMinor,
          revenuePerSlotMonthMinor: z.perSlotMonthMinor,
        }));
      return [];
    });
    localStorage.setItem('bault.locale', 'en');
    const { container } = render(
      <I18nProvider>
        <ShelfYieldPanel />
      </I18nProvider>,
    );
    await waitFor(() => expect(container.querySelector('.chart')).not.toBeNull());
    // Not in a note's padding: it begins where the table beside it begins.
    expect(container.querySelector('.chart-wrap')).not.toBeNull();
    expect(container.querySelector('.panel-note .chart')).toBeNull();
    const tableZones = Array.from(
      container.querySelectorAll('.panel table tbody tr td:first-child .dt-primary'),
    ).map((el) => el.textContent);
    for (const zone of ZONES) expect(tableZones).toContain(zone.label);
    expect(rowsOf(container).map(nameOf).sort()).toEqual(ZONES.map((z) => z.label).sort());
  });
});

describe.skipIf(!browser)('the chart, in a browser', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const locale of ['en', 'he'] as const) {
      it(`is read, drawn and thin, and has no flag: ${theme}, ${locale}, desktop and phone`, async () => {
        chart(locale);
        for (const width of [1280, 390]) {
          const page = await inBrowser(width, locale, theme);
          const flags = await audit.audit(page);
          expect(flags).toEqual([]);
          const marks = await page.$$eval('.chart-bar', (bars) =>
            bars.map((bar) => {
              const style = getComputedStyle(bar);
              return {
                height: Math.round(bar.getBoundingClientRect().height),
                // The end a bar grows toward is rounded, and the end it grows from, at the zero, is square.
                rounded: [
                  style.borderTopLeftRadius,
                  style.borderTopRightRadius,
                  style.borderBottomLeftRadius,
                  style.borderBottomRightRadius,
                ].map((r) => parseFloat(r) > 0),
              };
            }),
          );
          for (const mark of marks) {
            expect(mark.height).toBeLessThanOrEqual(24);
            expect(mark.rounded).toEqual(
              locale === 'he' ? [true, false, true, false] : [false, true, false, true],
            );
          }
          await page.context().close();
        }
      });
    }
  }

  it('begins every bar at the end the zero is at, and writes its value just past its end, in either language', async () => {
    for (const locale of ['en', 'he'] as const) {
      localStorage.setItem('bault.locale', locale);
      const { unmount } = chart(locale);
      const page = await inBrowser(1280, locale, 'dark');
      const geometry = await page.$$eval('.chart-row', (rows) =>
        rows.map((row) => {
          const track = row.querySelector('.chart-track')!.getBoundingClientRect();
          const bar = row.querySelector('.chart-bar')!.getBoundingClientRect();
          const value = row.querySelector('.chart-value')!.getBoundingClientRect();
          const ratio = parseFloat(
            (row.querySelector('.chart-track') as HTMLElement).style.getPropertyValue('--ratio'),
          );
          return {
            track: { left: track.left, right: track.right, width: track.width },
            bar: { left: bar.left, right: bar.right, width: bar.width },
            value: { left: value.left, right: value.right },
            ratio,
          };
        }),
      );
      for (const g of geometry) {
        // The bar is its ratio of the track (less the track's hairline), from the zero's end.
        expect(Math.abs(g.bar.width - g.ratio * g.track.width)).toBeLessThanOrEqual(2);
        if (locale === 'he') {
          expect(Math.abs(g.bar.right - g.track.right)).toBeLessThanOrEqual(2);
          // The value is past the bar's end, toward where the bars end: to its left.
          expect(g.value.right).toBeLessThanOrEqual(g.bar.left - 2 + 1);
        } else {
          expect(Math.abs(g.bar.left - g.track.left)).toBeLessThanOrEqual(2);
          expect(g.value.left).toBeGreaterThanOrEqual(g.bar.right + 2 - 1);
        }
      }
      // The ticks of the scale are where the bars would be at that value: $0 at the zero's end.
      const ticks = await page.$$eval('.chart-tick', (els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect();
          return { centre: (box.left + box.right) / 2, text: el.textContent };
        }),
      );
      const track = geometry[0]!.track;
      const at = (i: number) => (i / (ticks.length - 1)) * track.width;
      ticks.forEach((tick, i) => {
        const expected = locale === 'he' ? track.right - at(i) : track.left + at(i);
        expect(Math.abs(tick.centre - expected)).toBeLessThanOrEqual(3);
      });
      await page.context().close();
      unmount();
    }
  });

  it('colours the weakest in the amber and the rest in the text’s grey, whichever the theme', async () => {
    chart('en');
    for (const theme of ['dark', 'light'] as const) {
      const page = await inBrowser(1280, 'en', theme);
      const colours = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const probe = (value: string) => {
          const el = document.createElement('i');
          el.style.color = value;
          document.body.append(el);
          const resolved = getComputedStyle(el).color;
          el.remove();
          return resolved;
        };
        return {
          marked: getComputedStyle(document.querySelector('.chart-bar--mark')!).backgroundColor,
          plain: getComputedStyle(document.querySelector('.chart-bar:not(.chart-bar--mark)')!)
            .backgroundColor,
          amber: probe(root.getPropertyValue('--amber-mark')),
          grey: probe(root.getPropertyValue('--ink-2')),
        };
      });
      expect(colours.marked).toBe(colours.amber);
      expect(colours.plain).toBe(colours.grey);
      expect(colours.marked).not.toBe(colours.plain);
      await page.context().close();
    }
  });

  it('puts the name above the bar on a phone, which has the width, and leaves the scale to the values written at the bars', async () => {
    chart('en');
    const page = await inBrowser(390, 'en', 'dark');
    const phone = await page.$$eval('.chart-row', (rows) =>
      rows.map((row) => {
        const label = row.querySelector('.chart-label')!.getBoundingClientRect();
        const track = row.querySelector('.chart-track')!.getBoundingClientRect();
        return { labelAbove: label.bottom <= track.top + 1, trackWidth: track.width };
      }),
    );
    for (const row of phone) {
      expect(row.labelAbove).toBe(true);
      // Most of the width of the phone, not what is left of a line after a name.
      expect(row.trackWidth).toBeGreaterThan(200);
    }
    expect(await page.$eval('.chart-axis', (el) => getComputedStyle(el).display)).toBe('none');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    await page.context().close();
  });

  it('is as wide as the panel it is in allows and no wider than a chart is read: not a strip at the start of an empty page', async () => {
    chart('en');
    const wide = await inBrowser(1600, 'en', 'dark');
    const width = await wide.$eval('.chart', (el) => Math.round(el.getBoundingClientRect().width));
    expect(width).toBeGreaterThan(700);
    expect(width).toBeLessThanOrEqual(880);
    await wide.context().close();
  });
});
