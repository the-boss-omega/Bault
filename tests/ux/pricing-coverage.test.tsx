import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { billableActions, coverage } from '../../apps/api/src/modules/prc/billable-actions';

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

const { PricingCoveragePanel } =
  await import('../../apps/web/src/areas/admin/PricingCoveragePanel');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
  auditButtons: (page: Page) => Promise<string[]>;
};

/**
 * The pricing check, before launch: the verdict on a sheet, with how many of the actions have what they need as its
 * figure; beside it what does not (what is missing makes an action fail, and comes first); and what is fine folded
 * away under it. The data is the API's own function over the catalogue of actions the code charges for.
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
    viewport: { width, height: 1000 },
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

const rule = (actionType: string, value = 500, model = 'fixed') => ({
  id: `rule-${actionType}`,
  actionType,
  itemClass: null,
  model,
  value,
  currency: 'USD',
  effectiveFrom: '2026-10-27T12:00:00.000Z',
});

const CATALOGUE = billableActions();
// A rule for every action that can have one: the check says it is ready.
const ALL_RULES = CATALOGUE.filter((a) => a.resolution !== 'code_constant').map((a) =>
  rule(a.actionType, a.percentOf ? 1000 : 500, a.percentOf ? 'percentage' : 'fixed'),
);
const READY = JSON.parse(JSON.stringify(coverage(CATALOGUE, ALL_RULES)));
// The same without a rule for what must have one, for what falls back, and for what is free if it has none.
const WITHOUT = new Set([
  'parcel_forwarding',
  'storage',
  'intake_lot',
  'shipping_rush',
  'shipping_rush',
]);
const GAPS = JSON.parse(
  JSON.stringify(
    coverage(
      CATALOGUE,
      ALL_RULES.filter((r) => !WITHOUT.has(r.actionType)),
    ),
  ),
);
const UNKNOWN = {
  ...GAPS,
  unknownRules: [
    { id: 'u1', actionType: 'storge' },
    { id: 'u2', actionType: 'parcl_forwarding' },
  ],
};

const onError = vi.fn();
const onLoaded = vi.fn();

function check(data: unknown, locale: Locale = 'en') {
  localStorage.setItem('bault.locale', locale);
  get.mockResolvedValue(data);
  return render(
    <I18nProvider>
      <PricingCoveragePanel refreshKey={0} onError={onError} onLoaded={onLoaded} />
    </I18nProvider>,
  );
}

async function sheet() {
  return screen.findByRole('region', { name: /Launch check|בדיקת השקה/ });
}
const groupsOf = () => Array.from(document.querySelectorAll('tbody.roll-group')) as HTMLElement[];
const codes = (root: Element) =>
  Array.from(root.querySelectorAll('tr:not(.roll-group-head) td:first-child code')).map(
    (c) => c.textContent,
  );
const lineOf = (tag: HTMLElement, label: string) =>
  within(tag).getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;

beforeEach(() => {
  get.mockReset();
  onError.mockReset();
  onLoaded.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
});

describe('the sheet: the verdict on paper, and its figure', () => {
  it('says that every price is loaded when none is wanting, with how many of the actions are covered', async () => {
    check(READY);
    const tag = await sheet();
    expect(tag.querySelector('.drawer-tag-title')).toHaveTextContent('Every price is loaded');
    const total = READY.summary.total;
    // Covered is what has its own price and what needs none: the server's own meaning of ready.
    expect(tag.querySelector('.drawer-tag-amount')).toHaveTextContent(`${total} / ${total}`);
    expect(lineOf(tag, 'Priced by a rule')).toHaveTextContent(String(READY.summary.priced));
    expect(lineOf(tag, 'Fixed in the code')).toHaveTextContent(String(READY.summary.codeConstant));
    expect(lineOf(tag, 'Missing a rule')).toHaveTextContent('0');
    expect(lineOf(tag, 'On a fallback')).toHaveTextContent('0');
    expect(within(tag).getByText('Ready')).toBeInTheDocument();
    expect(tag.querySelector('.drawer-tag-note')).toHaveTextContent(`${total} actions`);
  });

  it('says that prices are missing when any is, and counts as covered only what is', async () => {
    check(GAPS);
    const tag = await sheet();
    expect(tag.querySelector('.drawer-tag-title')).toHaveTextContent('Prices are missing');
    const covered = GAPS.summary.priced + GAPS.summary.codeConstant;
    expect(covered).toBeLessThan(GAPS.summary.total);
    expect(tag.querySelector('.drawer-tag-amount')).toHaveTextContent(
      `${covered} / ${GAPS.summary.total}`,
    );
    expect(within(tag).getByText('Not ready')).toBeInTheDocument();
    expect(lineOf(tag, 'Missing a rule')).toHaveTextContent(String(GAPS.summary.missing));
    // A fallback, a code default and a free action are each on something that is not their own rule.
    expect(lineOf(tag, 'On a fallback')).toHaveTextContent(
      String(GAPS.summary.fallingBack + GAPS.summary.codeDefault + GAPS.summary.free),
    );
  });

  it('is the verdict of the server, not one of its own: it is ready when the server says so', async () => {
    check(READY);
    await sheet();
    expect(onLoaded).toHaveBeenCalledWith(READY);
    expect(screen.queryByText('Prices are missing')).toBeNull();
  });
});

describe('what is wrong, beside the sheet', () => {
  it('lists what is missing first and what relies on something else after it, a group each with its count', async () => {
    check(GAPS);
    await sheet();
    expect(groupsOf().map((g) => g.querySelector('.roll-group-name')?.textContent)).toEqual([
      'Needs a rule',
      'Relying on a fallback',
    ]);
    const [missing, fallback] = groupsOf() as [HTMLElement, HTMLElement];
    expect(missing.querySelector('.roll-group-count')).toHaveTextContent(
      String(GAPS.summary.missing),
    );
    expect(codes(missing)).toEqual(['parcel_forwarding', 'storage']);
    expect(codes(fallback)).toEqual(['intake_lot', 'shipping_rush']);
    // One table, whose column heads the groups share.
    expect(document.querySelectorAll('.coverage-gaps table')).toHaveLength(1);
  });

  it('says what each is priced by now, and where it falls back, what to', async () => {
    check(GAPS);
    await sheet();
    const row = (code: string) =>
      screen.getByText(code, { selector: 'code' }).closest('tr') as HTMLElement;
    expect(
      within(row('parcel_forwarding')).getByText('Missing — the action fails'),
    ).toBeInTheDocument();
    expect(within(row('shipping_rush')).getByText('Free without a rule')).toBeInTheDocument();
    const fallback = row('intake_lot');
    expect(within(fallback).getByText('Falls back to another rule')).toBeInTheDocument();
    expect(within(fallback).getByText('intake', { selector: 'code' })).toBeInTheDocument();
    // A rule that is not there is a dash, not $0.00.
    expect(fallback.querySelector('.coverage-cell--rule')).toHaveTextContent('—');
    // What each is for, as the server wrote it (in its own language).
    expect(within(row('parcel_forwarding')).getByText(/Forwarding a parcel/)).toHaveAttribute(
      'lang',
      'en',
    );
  });

  it('marks on the edge of its line what makes an action fail or free, and what relies on something else', async () => {
    check(GAPS);
    await sheet();
    const edge = (code: string) =>
      screen.getByText(code, { selector: 'code' }).closest('tr') as HTMLElement;
    expect(edge('parcel_forwarding')).toHaveClass('is-alert');
    expect(edge('shipping_rush')).toHaveClass('is-alert');
    expect(edge('intake_lot')).toHaveClass('is-attention');
  });

  it('says that nothing is wrong, in a note, where nothing is, and shows no table of gaps', async () => {
    check(READY);
    await sheet();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing is missing and nothing relies on a fallback.',
    );
    expect(document.querySelector('.coverage-gaps table')).toBeNull();
  });

  it('names a rule that the code never reads, which is probably a typo, beside what is wrong', async () => {
    check(UNKNOWN);
    await sheet();
    const note = screen.getByText(/never reads/).closest('.okbox') as HTMLElement;
    expect(note).toHaveClass('okbox--warning');
    expect(within(note).getByText('storge')).toBeInTheDocument();
    expect(within(note).getByText('parcl_forwarding')).toBeInTheDocument();
  });
});

describe('what is fine, folded under it', () => {
  it('is two lines that open, closed, each with how many it holds', async () => {
    check(READY);
    await sheet();
    const folds = Array.from(
      document.querySelectorAll('details.coverage-fold'),
    ) as HTMLDetailsElement[];
    expect(folds.map((f) => f.querySelector('.roll-group-name')?.textContent)).toEqual([
      'Priced',
      'Fixed in the code',
    ]);
    expect(folds.map((f) => f.querySelector('.roll-group-count')?.textContent)).toEqual([
      String(READY.summary.priced),
      String(READY.summary.codeConstant),
    ]);
    expect(folds.every((f) => !f.open)).toBe(true);
  });

  it('opens to every action with its rule: a dollar figure, or a percentage for what is a share of a sale', async () => {
    const user = userEvent.setup();
    check(READY);
    await sheet();
    const fold = document.querySelectorAll('details.coverage-fold')[0] as HTMLDetailsElement;
    await user.click(fold.querySelector('summary')!);
    expect(fold.open).toBe(true);
    expect(codes(fold)).toHaveLength(READY.summary.priced);
    const row = (code: string) =>
      within(fold).getByText(code, { selector: 'code' }).closest('tr') as HTMLElement;
    expect(row('parcel_processing').querySelector('.coverage-cell--rule')).toHaveTextContent(
      '$5.00',
    );
    // The marketplace fee is a share of the sale price: 1000 hundredths of a percent is 10%.
    expect(row('marketplace_fee').querySelector('.coverage-cell--rule')).toHaveTextContent('10%');
    expect(within(row('parcel_processing')).getByText('Priced')).toBeInTheDocument();
  });

  it('has no fold for a group that has no actions in it', async () => {
    const onlyPriced = {
      ...READY,
      summary: { ...READY.summary, codeConstant: 0 },
      actions: READY.actions.filter((a: { status: string }) => a.status === 'priced'),
    };
    check(onlyPriced);
    await sheet();
    expect(
      Array.from(document.querySelectorAll('details.coverage-fold')).map(
        (f) => f.querySelector('.roll-group-name')?.textContent,
      ),
    ).toEqual(['Priced']);
  });
});

describe('the check, again', () => {
  it('asks the server again when told, and shows what it says now', async () => {
    const user = userEvent.setup();
    check(GAPS);
    await sheet();
    expect(screen.getByText('Prices are missing')).toBeInTheDocument();
    get.mockResolvedValue(READY);
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Every price is loaded')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith('/admin/pricing/coverage');
    expect(onLoaded).toHaveBeenLastCalledWith(READY);
  });

  it('says why it could not be asked, and keeps the sheet it has', async () => {
    const user = userEvent.setup();
    check(GAPS);
    await sheet();
    get.mockRejectedValue(new Error('The price list is not reachable.'));
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('The price list is not reachable.'));
    expect(screen.getByText('Prices are missing')).toBeInTheDocument();
  });

  it('is read in Hebrew with the groups, the sheet and the figures in the words of the page', async () => {
    check(GAPS, 'he');
    const tag = await sheet();
    expect(tag.querySelector('.drawer-tag-title')).toHaveTextContent('חסרים מחירים');
    expect(within(tag).getByText('לא מוכן')).toBeInTheDocument();
    expect(groupsOf().map((g) => g.querySelector('.roll-group-name')?.textContent)).toEqual([
      'דורשות כלל',
      'נשענות על ברירת מחדל',
    ]);
    expect(tag.querySelector('.drawer-tag-amount .amount')).toHaveAttribute('dir', 'ltr');
  });
});

describe.skipIf(!browser)('the check, in a browser', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const locale of ['en', 'he'] as const) {
      it(`is read and reached without a flag, folds open and shut: ${theme}, ${locale}, desktop and phone`, async () => {
        const user = userEvent.setup();
        check(UNKNOWN, locale);
        await sheet();
        for (const open of [false, true]) {
          if (open) {
            for (const summary of Array.from(document.querySelectorAll('summary')))
              await user.click(summary);
          }
          for (const width of [1280, 390]) {
            const page = await inBrowser(width, locale, theme);
            expect(await audit.auditButtons(page)).toEqual([]);
            const flags = await audit.audit(page);
            expect(flags.filter((f) => !/^enum names on screen/.test(f))).toEqual([]);
            await page.context().close();
          }
        }
      });
    }
  }

  it('puts the sheet beside what is wrong where there is room, and over it on a phone', async () => {
    check(GAPS);
    await sheet();
    const box = (sel: string) =>
      `(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; })()`;
    const wide = await inBrowser(1280, 'en', 'dark');
    const w = {
      sheet: (await wide.evaluate(box('.coverage-sheet'))) as Record<string, number>,
      gaps: (await wide.evaluate(box('.coverage-gaps'))) as Record<string, number>,
      rest: (await wide.evaluate(box('.coverage-rest'))) as Record<string, number>,
    };
    expect(w.gaps.left).toBeGreaterThanOrEqual(w.sheet.right - 1);
    expect(Math.abs(w.gaps.top - w.sheet.top)).toBeLessThanOrEqual(2);
    expect(w.rest.top).toBeGreaterThanOrEqual(Math.max(w.sheet.bottom, w.gaps.bottom) - 1);
    await wide.context().close();

    const phone = await inBrowser(390, 'en', 'dark');
    const p = {
      sheet: (await phone.evaluate(box('.coverage-sheet'))) as Record<string, number>,
      gaps: (await phone.evaluate(box('.coverage-gaps'))) as Record<string, number>,
      sideways: (await phone.evaluate(
        'document.documentElement.scrollWidth - window.innerWidth',
      )) as number,
    };
    expect(p.gaps.top).toBeGreaterThanOrEqual(p.sheet.bottom - 1);
    expect(p.sideways).toBeLessThanOrEqual(0);
    await phone.context().close();
  });

  it('has the sheet as paper, in both themes', async () => {
    check(GAPS);
    await sheet();
    for (const theme of ['dark', 'light'] as const) {
      const page = await inBrowser(1280, 'en', theme);
      const paper = await page.$eval('.coverage-sheet .drawer-tag', (el) => {
        const style = getComputedStyle(el);
        return { bg: style.backgroundColor, color: style.color };
      });
      expect(paper).toEqual({ bg: 'rgb(243, 239, 230)', color: 'rgb(21, 19, 15)' });
      await page.context().close();
    }
  });

  it('turns an action into a card on a phone: its code and its rule on one line, what it is priced by under it, the edge coloured', async () => {
    check(GAPS);
    await sheet();
    const page = await inBrowser(390, 'en', 'dark');
    const card = await page.$eval('tr.is-alert', (tr) => {
      const rect = (sel: string) => {
        const b = tr.querySelector(sel)!.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: b.left };
      };
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement('i');
      probe.style.color = root.getPropertyValue('--oxblood-mark');
      document.body.append(probe);
      const oxblood = getComputedStyle(probe).color;
      return {
        display: getComputedStyle(tr).display,
        action: rect('.coverage-cell--action'),
        rule: rect('.coverage-cell--rule'),
        status: rect('.coverage-cell--status'),
        note: rect('.coverage-cell--note'),
        height: Math.round(tr.getBoundingClientRect().height),
        edge: getComputedStyle(tr).borderInlineStartColor,
        oxblood,
        labels: Array.from(tr.querySelectorAll('td')).map(
          (td) => getComputedStyle(td, '::before').display,
        ),
      };
    });
    expect(card.display).toBe('grid');
    expect(Math.abs(card.action.top - card.rule.top)).toBeLessThanOrEqual(8);
    expect(card.rule.left).toBeGreaterThan(card.action.left);
    expect(card.status.top).toBeGreaterThanOrEqual(card.action.bottom - 1);
    expect(card.note.top).toBeGreaterThanOrEqual(card.status.bottom - 1);
    expect(card.height).toBeLessThan(130);
    expect(card.edge).toBe(card.oxblood);
    expect(card.labels.every((d) => d === 'none')).toBe(true);
    await page.context().close();
  });

  it('is opened and shut from the keyboard, with Enter and with Space, by the line that names it', async () => {
    check(READY);
    await sheet();
    const page = await inBrowser(1280, 'en', 'dark');
    const open = () =>
      page.$$eval('details.coverage-fold', (folds) =>
        folds.map((f) => (f as HTMLDetailsElement).open),
      );
    await page.focus('details.coverage-fold:nth-of-type(1) > summary');
    expect(await open()).toEqual([false, false]);
    await page.keyboard.press('Enter');
    expect(await open()).toEqual([true, false]);
    await page.keyboard.press('Space');
    expect(await open()).toEqual([false, false]);
    // It is a stop of the keyboard's of its own, and a target.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('SUMMARY');
    const target = await page.$eval(
      'details.coverage-fold > summary',
      (el) => el.getBoundingClientRect().height,
    );
    expect(target).toBeGreaterThanOrEqual(44);
    await page.context().close();
  });

  it('turns the chevron down when a fold is open, and points it the way the page reads when it is shut', async () => {
    const user = userEvent.setup();
    check(READY, 'he');
    await sheet();
    const closed = await inBrowser(1280, 'he', 'dark');
    expect(
      await closed.$eval('.coverage-fold > summary svg', (el) => getComputedStyle(el).transform),
    ).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    await closed.context().close();
    await user.click(document.querySelector('summary')!);
    const open = await inBrowser(1280, 'he', 'dark');
    expect(
      await open.$eval(
        '.coverage-fold[open] > summary svg',
        (el) => getComputedStyle(el).transform,
      ),
    ).toBe('matrix(0, 1, -1, 0, 0, 0)');
    await open.context().close();
  });
});
