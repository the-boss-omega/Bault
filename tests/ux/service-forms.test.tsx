import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../../apps/web/src/shared/Barcode', () => ({
  Barcode: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodeLabel: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodePrintButton: () => <button type="button">Print</button>,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { VaultPage } = await import('../../apps/web/src/areas/customer/vault/VaultPage');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
  auditButtons: (page: Page) => Promise<string[]>;
};

/**
 * What can be asked for on a card: a menu of rows (the whole row is the button), and each request that has a form
 * is a slip: the request as it will be read, written while it is typed, with the fields under it.
 */
const ITEM = {
  id: 'i1',
  serialNumber: 'SN-CL10-0005',
  barcode: 'SN-CL10-0005',
  typeClass: 'trading_card',
  description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95',
  conditionGrade: 'Raw',
  lifecycleState: 'stored',
  binBarcode: 'BIN-66J7MRV8',
  binZone: 'A',
  isLot: false,
  lotSize: 1,
  oversized: false,
};

const TIERS = [
  {
    key: 'psa_value',
    label: 'PSA Value',
    gradingBody: 'PSA',
    maxDeclaredMinor: 49_900,
    turnaroundDaysMin: 45,
    turnaroundDaysMax: 65,
    requiresApproval: false,
    feeMinor: 2_500,
  },
  {
    key: 'psa_walkthrough',
    label: 'PSA Walkthrough',
    gradingBody: 'PSA',
    maxDeclaredMinor: 5_000_000,
    turnaroundDaysMin: 1,
    turnaroundDaysMax: 3,
    requiresApproval: true,
    feeMinor: null,
  },
];

const CHANNELS = [
  {
    key: 'card_show',
    label: 'Card show',
    gradedOnly: false,
    minAskingMinor: 0,
    requiresEvent: true,
    payoutDaysMin: 3,
    payoutDaysMax: 10,
    partnerFeeNote: '',
  },
  {
    key: 'auction_house',
    label: 'Auction house',
    gradedOnly: true,
    minAskingMinor: 5_000,
    requiresEvent: false,
    payoutDaysMin: 20,
    payoutDaysMax: 40,
    partnerFeeNote: '',
  },
];

let openRequests: { code: string; type: string; status: string; createdAt: string }[] = [];

function answer(path: string): Promise<unknown> {
  if (path.startsWith('/vault/items/i1/timeline')) return Promise.resolve([]);
  if (path.startsWith('/vault/items/i1/storage')) return Promise.reject(new Error('none'));
  if (path === '/vault/items/i1') return Promise.resolve({ images: [], openRequests });
  if (path.startsWith('/vault/items')) return Promise.resolve([ITEM]);
  if (path.startsWith('/vault/counts')) return Promise.resolve({ active: 1, hold: 0, history: 0 });
  if (path.startsWith('/vault/break-even')) return Promise.resolve({ items: [] });
  if (path.startsWith('/services/remove-commons/window'))
    return Promise.resolve({ windowDays: 30 });
  if (path === '/pricing/list') {
    const entry = (actionType: string, value: number) => ({
      actionType,
      description: actionType,
      model: 'fixed',
      value,
      currency: 'USD',
    });
    return Promise.resolve({
      groups: [
        {
          group: 'services',
          entries: [entry('service', 2_000), entry('service_fee:condition_inspection', 1_500)],
        },
      ],
    });
  }
  if (path === '/services/grading/tiers') {
    return Promise.resolve({ tiers: TIERS, walkthroughThresholdMinor: 100_000 });
  }
  if (path === '/services/consignment/channels') {
    return Promise.resolve({
      channels: CHANNELS,
      events: [
        {
          id: 'e1',
          name: 'Spring card show',
          venue: 'Hall',
          city: null,
          startsAt: '2026-12-10T10:00:00.000Z',
          requestDeadline: '2026-12-01T10:00:00.000Z',
          capacity: 40,
        },
      ],
    });
  }
  if (path === '/services/inspection/areas') {
    return Promise.resolve({ areas: ['corners', 'edges', 'surface', 'centering', 'creases'] });
  }
  return Promise.resolve({});
}

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

async function inBrowser(
  width: number,
  locale: Locale,
  theme: 'dark' | 'light',
  touch = false,
): Promise<Page> {
  const html = document.body.innerHTML;
  const context = await browser!.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: 'reduce',
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html lang="${locale}" dir="${locale === 'he' ? 'rtl' : 'ltr'}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bault</title><style>${CSS}</style></head><body>${html}</body></html>`,
  );
  return page;
}

async function openDrawer() {
  window.location.hash = '#/vault?item=i1';
  render(
    <I18nProvider>
      <VaultPage />
    </I18nProvider>,
  );
  // The menu is there when its first row is; its heading is in the page's language.
  await waitFor(() => expect(document.querySelector('[data-action="grading"]')).not.toBeNull());
}

const slip = () => document.querySelector('.request-slip') as HTMLElement;
const line = (label: string) => {
  const dt = within(slip()).getByText(label, { selector: 'dt' });
  return dt.closest('.ledger-line') as HTMLElement;
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) => answer(path));
  openRequests = [];
  localStorage.setItem('bault.locale', 'en');
  window.location.hash = '';
});

describe('the menu of what can be asked for', () => {
  it('is a row for each, named for what it is and described by what it does, with its price at the end', async () => {
    await openDrawer();
    const grading = await screen.findByRole('button', { name: 'Third-party grading' });
    expect(grading).toHaveAccessibleDescription(
      'Send the item to a third-party grader and receive a certificate.',
    );
    expect(grading).toHaveClass('btn--row');
    // Where there is a price it is the row's own: the generic service fee, and the inspection's.
    expect(
      within(screen.getByRole('button', { name: 'Professional photography' })).getByText('$20.00'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: 'Condition inspection' })).getByText('$15.00'),
    ).toBeInTheDocument();
    // What cannot be taken back is said in the row's colour first.
    expect(screen.getByRole('button', { name: 'Donation' })).toHaveClass('btn--danger');
    // A row that opens a form points the way on; one that does something does not.
    expect(grading.querySelector('.btn-row-end svg')).not.toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Professional photography' })
        .querySelector('.btn-row-end svg'),
    ).toBeNull();
  });

  it('shows a request already open as a row that is not there to press, with where it stands', async () => {
    openRequests = [
      {
        code: 'REQ-0042',
        type: 'condition_inspection',
        status: 'requested',
        createdAt: '2026-10-28',
      },
    ];
    await openDrawer();
    const row = await screen.findByRole('button', { name: 'Condition inspection' });
    await waitFor(() => expect(row).toBeDisabled());
    expect(row).toHaveAccessibleDescription(/REQ-0042/);
    // Neither its price nor the way on: there is nothing more to ask for.
    expect(row.querySelector('.btn-row-end')?.textContent).toBe('');
  });

  it('a form takes the menu’s place, takes the keyboard to its heading, and gives both back when it is closed', async () => {
    const user = userEvent.setup();
    await openDrawer();
    await user.click(await screen.findByRole('button', { name: 'Third-party grading' }));
    expect(screen.queryByRole('heading', { name: 'Actions' })).toBeNull();
    const heading = await screen.findByRole('heading', { name: 'Send for grading' });
    await waitFor(() => expect(heading).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const row = await screen.findByRole('button', { name: 'Third-party grading' });
    await waitFor(() => expect(row).toHaveFocus());
  });
});

describe('grading, as a slip', () => {
  async function openGrading() {
    const user = userEvent.setup();
    await openDrawer();
    await user.click(await screen.findByRole('button', { name: 'Third-party grading' }));
    await screen.findByRole('option', { name: 'PSA Value' });
    return user;
  }

  it('names the fee of the tier, in the display face, and says what the tier is, what it covers and how long it takes', async () => {
    await openGrading();
    await waitFor(() => expect(slip()).toHaveTextContent('$25.00'));
    expect(slip().querySelector('.drawer-tag-kicker')).toHaveTextContent('Grading fee');
    expect(within(line('Service level')).getByText('PSA Value')).toBeInTheDocument();
    expect(within(line('Turnaround')).getByText('45–65 days')).toBeInTheDocument();
    expect(within(line('Covers declared values up to')).getByText('$499.00')).toBeInTheDocument();
    // The consequence is on the slip, not a hint above the button.
    expect(slip()).toHaveTextContent(
      'While it is at the grader it cannot be sold, swapped or shipped.',
    );
  });

  it('writes the declared value as it is typed, and a dash until it is: never a figure made up', async () => {
    const user = await openGrading();
    expect(line('Declared value')).toHaveTextContent('—');
    await user.type(screen.getByLabelText('Declared value'), '250');
    expect(within(line('Declared value')).getByText('$250.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send for grading' })).toBeEnabled();
  });

  it('says what a tier with no price yet is, with no fee on the slip, and what one that needs a manager is', async () => {
    const user = await openGrading();
    await user.selectOptions(screen.getByLabelText('Service level'), 'psa_walkthrough');
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('—');
    expect(within(slip()).getByText('Price not set yet')).toBeInTheDocument();
    expect(within(line('Turnaround')).getByText('1–3 days')).toBeInTheDocument();
  });

  it('sends what the slip says', async () => {
    post.mockResolvedValue({});
    const user = await openGrading();
    await user.type(screen.getByLabelText('Declared value'), '250');
    await user.click(screen.getByRole('button', { name: 'Send for grading' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/services/grading', {
        itemId: 'i1',
        tier: 'psa_value',
        declaredMinor: 25_000,
      }),
    );
  });
});

describe('consignment, as a slip', () => {
  async function openConsignment() {
    const user = userEvent.setup();
    await openDrawer();
    await user.click(await screen.findByRole('button', { name: 'Consignment sale' }));
    await waitFor(() => expect(within(slip()).getByText('Card show')).toBeInTheDocument());
    return user;
  }

  it('is the asking price (a dash until it is typed), with where it goes, what comes back and when, and what it costs', async () => {
    const user = await openConsignment();
    expect(slip().querySelector('.drawer-tag-kicker')).toHaveTextContent('Asking price');
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('—');
    expect(within(line('Where to sell it')).getByText('Card show')).toBeInTheDocument();
    expect(within(line('Payout')).getByText('3–10 days after it sells')).toBeInTheDocument();
    expect(within(line('Service fee')).getByText('$20.00')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Asking price', { selector: 'input' }), '1200');
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('$1,200.00');
  });

  it('names the show once one is picked, and only where the channel is one that needs it', async () => {
    const user = await openConsignment();
    expect(line('Show')).toHaveTextContent('—');
    await user.selectOptions(screen.getByLabelText('Show'), 'e1');
    expect(within(line('Show')).getByText('Spring card show')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('Where to sell it', { selector: 'select' }),
      'auction_house',
    );
    expect(within(slip()).queryByText('Show', { selector: 'dt' })).toBeNull();
    // What the channel asks of a card is on the slip: its minimum, and that it takes graded cards only.
    expect(within(line('Minimum asking')).getByText('$50.00')).toBeInTheDocument();
    expect(within(line('Accepts')).getByText('graded items only')).toBeInTheDocument();
  });
});

describe('an inspection, as a slip', () => {
  async function openInspection() {
    const user = userEvent.setup();
    await openDrawer();
    await user.click(await screen.findByRole('button', { name: 'Condition inspection' }));
    await screen.findByRole('checkbox', { name: 'Corners' });
    return user;
  }

  it('is what it costs, and a finding for each area asked for', async () => {
    const user = await openInspection();
    expect(slip().querySelector('.drawer-tag-kicker')).toHaveTextContent('Inspection fee');
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('$15.00');
    await waitFor(() => expect(slip().querySelectorAll('.ledger-line')).toHaveLength(5));
    expect(within(line('Corners')).getByText('One finding')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Edges' }));
    expect(slip().querySelectorAll('.ledger-line')).toHaveLength(4);
    expect(within(slip()).queryByText('Edges')).toBeNull();
  });

  it('asks for at least one area, and sends the areas on the slip', async () => {
    post.mockResolvedValue({});
    const user = await openInspection();
    for (const area of ['Edges', 'Surface', 'Centering', 'Creases']) {
      await user.click(screen.getByRole('checkbox', { name: area }));
    }
    await user.click(screen.getByRole('checkbox', { name: 'Corners' }));
    expect(screen.getByText('Choose at least one area')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request inspection' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Surface' }));
    await user.click(screen.getByRole('button', { name: 'Request inspection' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/services/inspection', {
        itemId: 'i1',
        areas: ['surface'],
      }),
    );
  });

  it('keeps the choices in a group named by what is asked of the person', async () => {
    await openInspection();
    const group = screen.getByRole('group', {
      name: 'Choose the areas you care about. Each one gets its own finding.',
    });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(5);
  });
});

describe('a request for something else, as a slip', () => {
  it('is the request as it will be read: what is wanted as its title, how it is put under it, and that asking is free', async () => {
    const user = userEvent.setup();
    await openDrawer();
    await user.click(await screen.findByRole('button', { name: 'Ask for something else' }));
    // The words that have not been written are asked for in the quieter ink, as the name of the field.
    expect(slip().querySelector('.drawer-tag-title')).toHaveTextContent('What you want');
    expect(slip().querySelector('.drawer-tag-title .drawer-tag-quiet')).not.toBeNull();

    await user.type(screen.getByLabelText('What you want'), 'Sleeve it before shipping');
    await user.type(
      screen.getByLabelText('The detail'),
      'A penny sleeve and a top loader, please.',
    );
    expect(slip().querySelector('.drawer-tag-title')).toHaveTextContent(
      'Sleeve it before shipping',
    );
    expect(slip().querySelector('.drawer-tag-title .drawer-tag-quiet')).toBeNull();
    expect(slip().querySelector('.ticket-note p')).toHaveTextContent(
      'A penny sleeve and a top loader, please.',
    );
    expect(slip()).toHaveTextContent(
      'Asking is free. Nothing is charged until you see a price and accept it.',
    );
  });
});

describe.skipIf(!browser)('the menu and the slips, in a browser', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const locale of ['en', 'he'] as const) {
      it(`every row of the menu is read, edged and a finger's width tall: ${theme}, ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        await openDrawer();
        const page = await inBrowser(390, locale, theme, true);
        expect(await audit.auditButtons(page)).toEqual([]);
        const heights = await page.$$eval('.service-menu .btn--row', (rows) =>
          rows.map((row) => Math.round(row.getBoundingClientRect().height)),
        );
        expect(heights.length).toBeGreaterThan(5);
        for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
        const flags = await audit.audit(page);
        expect(flags.filter((f) => /color-contrast/.test(f))).toEqual([]);
        await page.context().close();
      });
    }
  }

  for (const locale of ['en', 'he'] as const) {
    it(`starts its words where the page starts, and the way on turns with the page: ${locale}`, async () => {
      localStorage.setItem('bault.locale', locale);
      await openDrawer();
      const page = await inBrowser(1100, locale, 'dark');
      const read = await page.$eval('[data-action="grading"]', (row) => {
        const rtl = document.documentElement.dir === 'rtl';
        const name = row.querySelector('.btn-row-name')!.getBoundingClientRect();
        const box = row.getBoundingClientRect();
        return {
          // How far the name is from the edge the page starts at, and from the one it ends at.
          fromStart: rtl ? box.right - name.right : name.left - box.left,
          fromEnd: rtl ? name.left - box.left : box.right - name.right,
          chevron: getComputedStyle(row.querySelector('.btn-row-end svg')!).transform,
        };
      });
      expect(read.fromStart).toBeLessThan(read.fromEnd);
      expect(read.chevron).toBe(
        locale === 'he' ? 'matrix(-1, 0, 0, 1, 0, 0)' : 'matrix(1, 0, 0, 1, 0, 0)',
      );
      await page.context().close();
    });
  }

  it('puts a slip over its fields at the width of the drawer’s column, on a wide window and on a phone', async () => {
    const user = userEvent.setup();
    await openDrawer();
    await user.click(await screen.findByRole('button', { name: 'Third-party grading' }));
    await screen.findByRole('option', { name: 'PSA Value' });
    for (const width of [1100, 390]) {
      const page = await inBrowser(width, 'en', 'dark', width < 800);
      const box = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        const slipBox = rect('.request-slip');
        const fields = rect('.request-form-fields');
        const actions = rect('.request-form-actions');
        return {
          slipWidth: Math.round(slipBox.width),
          fieldsWidth: Math.round(fields.width),
          slipAbove: slipBox.bottom <= fields.top + 1,
          actionsBelow: actions.top >= fields.bottom - 1,
        };
      });
      expect(box.slipWidth).toBe(box.fieldsWidth);
      expect(box.slipAbove).toBe(true);
      expect(box.actionsBelow).toBe(true);
      await page.context().close();
    }
  });

  it('draws a chosen area as a button that is down, and a ring round the tile when the keyboard is on it', async () => {
    const user = userEvent.setup();
    await openDrawer();
    await user.click(await screen.findByRole('button', { name: 'Condition inspection' }));
    await screen.findByRole('checkbox', { name: 'Corners' });
    const page = await inBrowser(1100, 'en', 'dark');
    // The page is the markup as it was first drawn (every area asked for); a click in it toggles a tile as it would.
    await page.getByRole('checkbox', { name: 'Edges' }).click();
    // The pointer is on the tile it clicked, which lights it as a tile under a pointer is; it is moved off, and the
    // edge (it is transitioned to) is given the time to come to where it is going.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    const tiles = await page.$$eval('.choice-tile', (els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        return {
          checked: (el.querySelector('input') as HTMLInputElement).checked,
          border: style.borderTopColor,
          shadow: style.boxShadow,
        };
      }),
    );
    const on = tiles.find((t) => t.checked)!;
    const off = tiles.find((t) => !t.checked)!;
    expect(on.border).not.toBe(off.border);
    expect(on.shadow).not.toBe(off.shadow);
    await page.focus('.choice-tile input');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ring = await page.$eval('.choice-tile:has(input:focus-visible)', (el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(ring.style).toBe('solid');
    expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
    await page.context().close();
  });
});
