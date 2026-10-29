import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
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
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { WalletRequestsSection } =
  await import('../../apps/web/src/areas/admin/WalletRequestsSection');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
  auditButtons: (page: Page) => Promise<string[]>;
};

/**
 * The wallet-requests desk: a roll grouped by what each request needs of the person at it (a decision, seeing it
 * through, nothing), its filters named, and a request opened as the tag it is, with what the next step does to the
 * money said before the step is pressed and what was done, and why it failed if it did, said in the drawer.
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

async function inBrowser(
  width: number,
  locale: Locale,
  theme: 'dark' | 'light',
  height = 1000,
): Promise<Page> {
  const html = document.body.innerHTML;
  const context = await browser!.newContext({
    viewport: { width, height },
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

/** A day, at noon, so that "n days ago" is n whenever in the day the test runs. */
const at = (daysAgo: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

interface Row {
  id: string;
  code: string;
  userId: string;
  type: 'cash_in' | 'cash_out';
  status: string;
  amount: number;
  currency: string;
  fundingSource: string | null;
  destinationAccount: string | null;
  beneficiaryName: string | null;
  reference: string | null;
  documentKey: string | null;
  notes: string | null;
  settledLedgerId: string | null;
  payoutReference: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  username: string;
  customerName: string;
  email: string;
}

const row = (n: number, over: Partial<Row>): Row => ({
  id: `req-${n}`,
  code: `WR-${n}`,
  userId: `user-${n}`,
  type: 'cash_in',
  status: 'submitted',
  amount: 10000,
  currency: 'USD',
  fundingSource: null,
  destinationAccount: null,
  beneficiaryName: null,
  reference: null,
  documentKey: null,
  notes: null,
  settledLedgerId: null,
  payoutReference: null,
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  completedAt: null,
  createdAt: at(1),
  updatedAt: at(1),
  username: `user${n}`,
  customerName: `Customer ${n}`,
  email: `c${n}@example.com`,
  ...over,
});

const LONG_NOTE =
  'Please send before Thursday: the flight is on Friday and the bank takes two days on its side. ' +
  'If it cannot be done by Thursday please write to me first, because I would rather change the date.';

const ROWS: Row[] = [
  row(1042, {
    type: 'cash_out',
    status: 'submitted',
    amount: 50000,
    createdAt: at(2),
    updatedAt: at(2),
    customerName: 'Dana Levi',
    username: 'dana',
    destinationAccount: 'IL620108000000099999999',
    beneficiaryName: 'Dana Levi',
    notes: LONG_NOTE,
  }),
  row(1041, {
    type: 'cash_in',
    status: 'pending_review',
    amount: 120000,
    createdAt: at(3),
    updatedAt: at(2),
    customerName: 'נועם כץ',
    username: 'noam',
    fundingSource: 'bank_transfer',
    reference: 'TRF-88213',
  }),
  row(1039, {
    type: 'cash_out',
    status: 'approved',
    amount: 235000,
    createdAt: at(6),
    updatedAt: at(1),
    customerName: 'Yael Mizrahi',
    username: 'yaelm',
    destinationAccount: 'GB29NWBK60161331926819',
    beneficiaryName: 'Yael Mizrahi',
  }),
  row(1038, {
    type: 'cash_in',
    status: 'processing',
    amount: 30000,
    createdAt: at(9),
    updatedAt: at(1),
    customerName: 'Eitan Bar',
    username: 'eitanb',
    fundingSource: 'card',
  }),
  row(1036, {
    type: 'cash_out',
    status: 'paying',
    amount: 78000,
    createdAt: at(4),
    updatedAt: at(1),
    customerName: 'Maya Cohen',
    username: 'maya',
    destinationAccount: 'IL620108000000012345678',
    beneficiaryName: 'Maya Cohen',
  }),
  row(1030, {
    type: 'cash_in',
    status: 'completed',
    amount: 15000,
    createdAt: at(12),
    updatedAt: at(10),
    customerName: 'Omer Peretz',
    username: 'omerp',
    fundingSource: 'paypal',
  }),
  row(1029, {
    type: 'cash_out',
    status: 'rejected',
    amount: 9000,
    createdAt: at(15),
    updatedAt: at(14),
    customerName: 'Shira Adler',
    username: 'shira',
    destinationAccount: 'IL070108000000055555555',
    beneficiaryName: 'S. Adler',
    rejectionReason: 'The name on the account does not match the name on the wallet.',
  }),
  row(1025, {
    type: 'cash_out',
    status: 'payout_failed',
    amount: 64000,
    createdAt: at(20),
    updatedAt: at(18),
    customerName: 'Guy Shapira',
    username: 'guys',
    destinationAccount: 'IL100108000000077777777',
    beneficiaryName: 'Guy Shapira',
  }),
  row(1020, {
    type: 'cash_in',
    status: 'cancelled',
    amount: 7500,
    createdAt: at(26),
    updatedAt: at(26),
    customerName: 'Lior Ben-David',
    username: 'lior',
    fundingSource: 'crypto',
  }),
];

const NEXT: Record<string, string> = {
  review: 'pending_review',
  approve: 'approved',
  processing: 'processing',
  complete: 'completed',
  reject: 'rejected',
};

/** The API of the desk: it filters as the server does, serves a request's detail, and moves a request on when told to. */
function serve(initial: Row[] = ROWS) {
  // The server's order is not the desk's: the desk is what puts them in order.
  const list = initial.map((r) => ({ ...r })).reverse();
  const history = (r: Row) => [
    {
      id: `${r.id}-e1`,
      requestId: r.id,
      actorId: null,
      actorRole: 'user',
      fromStatus: null,
      toStatus: 'submitted',
      reason: null,
      occurredAt: r.createdAt,
    },
  ];
  get.mockImplementation(async (path: string) => {
    const [route, query = ''] = path.split('?');
    const q = new URLSearchParams(query);
    if (route === '/admin/wallet-requests') {
      return list.filter(
        (r) =>
          (!q.get('type') || r.type === q.get('type')) &&
          (!q.get('status') || r.status === q.get('status')) &&
          (!q.get('from') || r.createdAt.slice(0, 10) >= q.get('from')!) &&
          (!q.get('to') || r.createdAt.slice(0, 10) <= q.get('to')!),
      );
    }
    const found = route.match(/^\/admin\/wallet-requests\/(.+)$/);
    if (found) {
      const r = list.find((x) => x.id === found[1]);
      if (!r) throw new Error('Request not found');
      return { ...r, history: history(r) };
    }
    return [];
  });
  post.mockImplementation(async (path: string) => {
    const found = path.match(/^\/admin\/wallet-requests\/(.+)\/(\w+)$/);
    if (!found) return {};
    const r = list.find((x) => x.id === found[1]);
    const status = NEXT[found[2]!];
    if (!r || !status) throw new Error('Unknown request');
    r.status = status;
    r.updatedAt = new Date().toISOString();
    return { id: r.id, status };
  });
}

const wrap = (me = 'me') => (
  <I18nProvider>
    <WalletRequestsSection currentUserId={me} onMsg={onMsg} onError={onError} />
  </I18nProvider>
);
const onMsg = vi.fn();
const onError = vi.fn();

const groups = () => Array.from(document.querySelectorAll('tbody.roll-group')) as HTMLElement[];
const codesIn = (group: HTMLElement) =>
  Array.from(group.querySelectorAll('.register-link')).map((el) => el.textContent);
const lineFor = (code: string) =>
  screen.getByRole('button', { name: code }).closest('tr') as HTMLElement;
const dialog = (name: string) => screen.findByRole('dialog', { name });
const IDS = Object.fromEntries(ROWS.map((r) => [r.code, r.id]));

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  onMsg.mockReset();
  onError.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  window.location.hash = '#/admin/requests';
  serve();
});

async function desk(me?: string) {
  const view = render(wrap(me));
  await screen.findByRole('heading', { name: /^Wallet requests \(/ });
  await waitFor(() => expect(groups().length).toBeGreaterThan(0));
  return view;
}

describe('the requests, a roll grouped by what each needs', () => {
  it('has what needs a decision first, then what is in progress, then what is closed, each with its count', async () => {
    await desk();
    expect(groups().map((g) => g.querySelector('.roll-group-name')?.textContent)).toEqual([
      'Needs a decision',
      'In progress',
      'Closed',
    ]);
    expect(groups().map((g) => g.querySelector('.roll-group-count')?.textContent)).toEqual([
      '2',
      '3',
      '4',
    ]);
    // The groups are rowgroups of the one table, whose column heads they share.
    expect(document.querySelectorAll('table')).toHaveLength(1);
    expect(groups().map((g) => g.querySelector('th')?.getAttribute('scope'))).toEqual([
      'rowgroup',
      'rowgroup',
      'rowgroup',
    ]);
  });

  it('serves what is waiting in the order it came, and lists what is closed latest first, whatever order the API gave', async () => {
    await desk();
    const [decide, carry, closed] = groups() as [HTMLElement, HTMLElement, HTMLElement];
    // Waiting: the longest first (WR-1041 is three days old, WR-1042 two).
    expect(codesIn(decide)).toEqual(['WR-1041', 'WR-1042']);
    expect(codesIn(carry)).toEqual(['WR-1038', 'WR-1039', 'WR-1036']);
    // Closed: the one that was closed last first.
    expect(codesIn(closed)).toEqual(['WR-1030', 'WR-1029', 'WR-1025', 'WR-1020']);
  });

  it('says what money the groups in hand hold, by the kind of money, and does not for the closed ones', async () => {
    await desk();
    const [decide, carry, closed] = groups() as [HTMLElement, HTMLElement, HTMLElement];
    expect(decide.querySelector('.roll-group-sums')).toHaveTextContent('Cash in $1,200.00');
    expect(decide.querySelector('.roll-group-sums')).toHaveTextContent('Cash out $500.00');
    expect(carry.querySelector('.roll-group-sums')).toHaveTextContent('Cash in $300.00');
    // 2,350.00 and 780.00, both cash out.
    expect(carry.querySelector('.roll-group-sums')).toHaveTextContent('Cash out $3,130.00');
    expect(closed.querySelector('.roll-group-sums')).toBeNull();
  });

  it('leads a line with its number as a link, what it is for, whose it is, the sum, its age while it waits, and where it stands', async () => {
    await desk();
    const line = lineFor('WR-1042');
    expect(line.querySelector('.roll-account-text .dt-sub')).toHaveTextContent(
      'Cash out · Dana Levi',
    );
    const customer = line.querySelector('.roll-cell--customer') as HTMLElement;
    expect(within(customer).getByText('Dana Levi', { selector: 'bdi' })).toBeInTheDocument();
    expect(within(customer).getByText('@dana')).toBeInTheDocument();
    expect(within(line).getByText('$500.00')).toBeInTheDocument();
    expect(within(line).getByText('2 days ago')).toBeInTheDocument();
    expect(within(line).getByText('Submitted')).toBeInTheDocument();
    // A cash-in is for a way of funding it; a closed request has no age, only its date.
    expect(lineFor('WR-1041').querySelector('.roll-account-text .dt-sub')).toHaveTextContent(
      'Cash in · Bank transfer',
    );
    expect(lineFor('WR-1030').querySelector('.roll-when .dt-sub')).toBeNull();
    expect(lineFor('WR-1030').querySelector('.roll-when')).not.toBeNull();
  });

  it('marks, on the edge of the line, what needs a decision and what failed to pay', async () => {
    await desk();
    const attention = Array.from(document.querySelectorAll('tr.is-attention')).map(
      (tr) => tr.querySelector('.register-link')?.textContent,
    );
    expect(attention).toEqual(['WR-1041', 'WR-1042']);
    const alert = Array.from(document.querySelectorAll('tr.is-alert')).map(
      (tr) => tr.querySelector('.register-link')?.textContent,
    );
    expect(alert).toEqual(['WR-1025']);
  });

  it('draws the way the money goes: down into the wallet for cash in, up and out of it for cash out', async () => {
    await desk();
    const glyph = (code: string) => lineFor(code).querySelector('.roll-glyph svg');
    expect(glyph('WR-1041')).not.toBeNull();
    expect(glyph('WR-1042')).not.toBeNull();
    expect(glyph('WR-1041')!.innerHTML).not.toBe(glyph('WR-1042')!.innerHTML);
    // A mark is decoration: the line says "Cash in" and "Cash out" in words.
    expect(lineFor('WR-1041').querySelector('.roll-glyph')).toHaveAttribute('aria-hidden', 'true');
  });

  it('files a status it has not heard of as work in hand, not among what is closed, and says nothing of what comes next', async () => {
    serve([...ROWS, row(1099, { status: 'on_hold', createdAt: at(5), updatedAt: at(5) })]);
    const user = userEvent.setup();
    await desk();
    expect(codesIn(groups()[1]!)).toContain('WR-1099');
    expect(codesIn(groups()[2]!)).not.toContain('WR-1099');
    await user.click(screen.getByRole('button', { name: 'WR-1099' }));
    const drawer = await dialog('WR-1099');
    await within(drawer).findByRole('region', { name: 'Cash in' });
    expect(drawer.querySelector('.desk-next')).toBeNull();
  });

  it('says that nothing is waiting, where nothing is and nothing has been filtered out', async () => {
    serve(ROWS.filter((r) => r.status === 'completed' || r.status === 'rejected'));
    await desk();
    const [decide] = groups() as [HTMLElement];
    expect(decide.querySelector('.roll-group-name')).toHaveTextContent('Needs a decision');
    expect(decide.querySelector('.roll-group-count')).toHaveTextContent('0');
    expect(within(decide).getByText('Nothing is waiting for a decision.')).toBeInTheDocument();
    // A group with nothing in it and nothing to say is not shown at all.
    expect(groups().map((g) => g.querySelector('.roll-group-name')?.textContent)).toEqual([
      'Needs a decision',
      'Closed',
    ]);
  });

  it('is read in Hebrew with the groups, the ages and the money in the words of the page', async () => {
    localStorage.setItem('bault.locale', 'he');
    render(wrap());
    await screen.findByRole('heading', { name: /^בקשות ארנק \(/ });
    await waitFor(() => expect(groups().length).toBe(3));
    expect(groups().map((g) => g.querySelector('.roll-group-name')?.textContent)).toEqual([
      'ממתינות להחלטה',
      'בתהליך',
      'סגורות',
    ]);
    // Three days is "3 ימים", from the browser's own tables.
    expect(within(lineFor('WR-1041')).getByText('לפני 3 ימים')).toBeInTheDocument();
    expect(within(lineFor('WR-1042')).getByText('שלשום')).toBeInTheDocument();
    // The sum is a figure: it is read left to right in a Hebrew sentence.
    expect(groups()[0]!.querySelector('.roll-group-sums .num')).toHaveAttribute('dir', 'ltr');
  });
});

describe('the filters', () => {
  it('are named, in the open, and not by a label no one sees', async () => {
    await desk();
    const bar = screen.getByRole('group', { name: 'Filter requests' });
    for (const name of ['Type', 'Status', 'From', 'To']) {
      const control = within(bar).getByLabelText(name);
      const label = bar.querySelector(`label[for="${control.id}"]`);
      expect(label).toBeInTheDocument();
      expect(label).toBeVisible();
    }
    expect(within(bar).queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('ask the server for what they say, offer to be cleared once set, and clear', async () => {
    const user = userEvent.setup();
    await desk();
    await user.selectOptions(screen.getByLabelText('Type'), 'cash_in');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/admin/wallet-requests?type=cash_in'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'WR-1042' })).toBeNull());
    expect(screen.getByRole('button', { name: 'WR-1041' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2020-01-01' } });
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/admin/wallet-requests?type=cash_in&from=2020-01-01'),
    );

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'WR-1042' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Type')).toHaveValue('all');
    expect(screen.getByLabelText('From')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('say that nothing matches, and offer to clear them, where they leave nothing', async () => {
    const user = userEvent.setup();
    await desk();
    await user.selectOptions(screen.getByLabelText('Status'), 'cancelled');
    await user.selectOptions(screen.getByLabelText('Type'), 'cash_out');
    expect(await screen.findByText('No requests match these filters')).toBeInTheDocument();
    // One in the bar, one with the empty state, both of which clear.
    const clears = screen.getAllByRole('button', { name: 'Clear filters' });
    expect(clears).toHaveLength(2);
    await user.click(clears[1]!);
    expect(await screen.findByRole('button', { name: 'WR-1042' })).toBeInTheDocument();
  });

  it('say that there are none, not that none match, where there are none to match', async () => {
    serve([]);
    render(wrap());
    expect(await screen.findByText('No wallet requests have been made yet.')).toBeInTheDocument();
    expect(screen.queryByText('No requests match these filters')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });
});

describe('a request, opened', () => {
  it('opens by its address, from its number, with the whole of it on a tag', async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole('button', { name: 'WR-1042' }));
    expect(window.location.hash).toBe(`#/admin/requests?request=${IDS['WR-1042']}`);
    const drawer = await dialog('WR-1042');
    const tag = within(drawer).getByRole('region', { name: 'Cash out' });
    // The tag is about whose it is and how much, with where it stands in its foot.
    expect(tag.querySelector('.drawer-tag-title')).toHaveTextContent('Dana Levi');
    expect(tag.querySelector('.drawer-tag-amount')).toHaveTextContent('$500.00');
    expect(within(tag).getByText('Submitted')).toBeInTheDocument();
    expect(tag.querySelector('.drawer-tag-note')).toHaveTextContent('USD');
    const value = (label: string) =>
      within(tag).getByText(label, { selector: 'dt' }).nextElementSibling;
    expect(value('Username')).toHaveTextContent('@dana');
    expect(value('Email')).toHaveTextContent('c1042@example.com');
    expect(value('Destination account')).toHaveTextContent('IL620108000000099999999');
    expect(value('Beneficiary name')).toHaveTextContent('Dana Levi');
    // What the customer wrote is read whole, not to its sixth line.
    const note = tag.querySelector('.ticket-note')!;
    expect(note).toHaveClass('ticket-note--whole');
    expect(note).toHaveTextContent(LONG_NOTE);
    // A line the request did not have is not there as a dash.
    expect(within(tag).queryByText('Reference', { selector: 'dt' })).toBeNull();
    expect(within(tag).queryByText('Supporting document', { selector: 'dt' })).toBeNull();
    expect(within(drawer).getByText('Created as Submitted')).toBeInTheDocument();
  });

  it('is open on arrival where the address says which', async () => {
    window.location.hash = `#/admin/requests?request=${IDS['WR-1041']}`;
    render(wrap());
    const drawer = await dialog('WR-1041');
    expect(within(drawer).getByRole('region', { name: 'Cash in' })).toBeInTheDocument();
    expect(
      within(drawer).getByText('Funding source', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('Bank transfer');
    expect(
      within(drawer).getByText('Reference', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('TRF-88213');
  });

  it('says what the next step does to the money, before it is pressed, for every status a request has', async () => {
    const user = userEvent.setup();
    await desk();
    const said: Record<string, string> = {};
    for (const r of ROWS) {
      await user.click(screen.getByRole('button', { name: r.code }));
      const drawer = await dialog(r.code);
      await waitFor(() => expect(drawer.querySelector('.desk-next')).not.toBeNull());
      said[r.status] = drawer.querySelector('.desk-next')!.textContent!;
      await user.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(said.submitted).toBe('Not looked at yet. Nothing moves until it is completed.');
    expect(said.approved).toMatch(/only step that moves money/);
    expect(said.processing).toMatch(/only step that moves money/);
    expect(said.paying).toMatch(/payment provider/);
    expect(said.completed).toMatch(/recorded in the customer’s wallet/);
    expect(said.rejected).toMatch(/shown the reason/);
    expect(said.payout_failed).toMatch(/money is back in the customer’s wallet/);
    expect(new Set(Object.values(said)).size).toBe(Object.keys(said).length);
  });

  it('puts the steps in the foot, the way on first and the one that cannot be taken back as the danger', async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole('button', { name: 'WR-1042' }));
    const drawer = await dialog('WR-1042');
    const foot = drawer.querySelector('.drawer-foot') as HTMLElement;
    const buttons = within(foot).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Move to review',
      'Approve',
      'Reject',
      'Close',
    ]);
    expect(buttons.map((b) => b.className.match(/btn--(\w+)/)?.[1])).toEqual([
      'secondary',
      'primary',
      'danger',
      'ghost',
    ]);
  });

  it('offers a request that you raised yourself to no one but another administrator, and says so', async () => {
    const user = userEvent.setup();
    await desk('user-1042');
    await user.click(screen.getByRole('button', { name: 'WR-1042' }));
    const drawer = await dialog('WR-1042');
    expect(
      within(drawer).getByText(
        'You raised this request yourself — another administrator must decide it.',
      ),
    ).toBeInTheDocument();
    const foot = drawer.querySelector('.drawer-foot') as HTMLElement;
    expect(
      within(foot)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Close']);
  });

  it('offers no step to what is closed', async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole('button', { name: 'WR-1029' }));
    const drawer = await dialog('WR-1029');
    const foot = drawer.querySelector('.drawer-foot') as HTMLElement;
    expect(
      within(foot)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Close']);
    // The reason it was turned down is on the tag, read whole.
    expect(drawer.querySelector('.ticket-note')).toHaveTextContent(
      'The name on the account does not match the name on the wallet.',
    );
  });

  it('says why it could not be read, and tries again', async () => {
    const user = userEvent.setup();
    await desk();
    const real = get.getMockImplementation()!;
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/req-1042')) throw new Error('The ledger is busy.');
      return real(path);
    });
    await user.click(screen.getByRole('button', { name: 'WR-1042' }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('The ledger is busy.')).toBeInTheDocument();
    get.mockImplementation(real);
    await user.click(within(drawer).getByRole('button', { name: 'Try again' }));
    expect(await within(drawer).findByRole('region', { name: 'Cash out' })).toBeInTheDocument();
    expect(within(drawer).queryByText('The ledger is busy.')).toBeNull();
  });
});

describe('what is done to a request', () => {
  it('is done from the foot, said in the drawer where it is read, and the line is moved to where it now belongs', async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole('button', { name: 'WR-1041' }));
    const drawer = await dialog('WR-1041');
    await user.click(within(drawer).getByRole('button', { name: 'Approve' }));
    expect(post).toHaveBeenCalledWith('/admin/wallet-requests/req-1041/approve', {});
    // Said in the dialog (behind its backdrop the page's own line is not seen) and, for the record, on the page.
    const notice = await within(drawer).findByText('Request WR-1041: Approved.');
    expect(notice.closest('.drawer-notice')).not.toBeNull();
    expect(onMsg).toHaveBeenCalledWith('Request WR-1041: Approved.');
    expect(onError).not.toHaveBeenCalled();
    // The tag says where it stands now, and the steps are the next ones.
    expect(within(drawer).getByText('Approved', { selector: '.pill' })).toBeInTheDocument();
    const foot = drawer.querySelector('.drawer-foot') as HTMLElement;
    expect(
      within(foot)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Mark processing', 'Complete and move money', 'Reject', 'Close']);
    // And the roll behind has moved it, from what needs a decision to what is in hand.
    await waitFor(() => expect(codesIn(groups()[0]!)).toEqual(['WR-1042']));
    expect(codesIn(groups()[1]!)).toContain('WR-1041');
  });

  it('keeps the keyboard in the dialog when the button that was pressed is the thing the answer removed', async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole('button', { name: 'WR-1041' }));
    const drawer = await dialog('WR-1041');
    const approve = within(drawer).getByRole('button', { name: 'Approve' });
    approve.focus();
    await user.keyboard('{Enter}');
    await within(drawer).findByText('Request WR-1041: Approved.');
    // "Approve" is gone, and focus was on it: it is in the dialog still, not on the page behind.
    expect(approve).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(drawer.contains(document.activeElement)).toBe(true);
  });

  it('returns the keyboard to the line that was opened, even where the line has moved to another group', async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole('button', { name: 'WR-1041' }));
    const drawer = await dialog('WR-1041');
    await user.click(within(drawer).getByRole('button', { name: 'Approve' }));
    await within(drawer).findByText('Request WR-1041: Approved.');
    await user.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#/admin/requests');
    const link = screen.getByRole('button', { name: 'WR-1041' });
    expect(link.closest('tbody')!.querySelector('.roll-group-name')).toHaveTextContent(
      'In progress',
    );
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it('says in the drawer why a step could not be taken, and not on the page behind it', async () => {
    const user = userEvent.setup();
    await desk();
    post.mockRejectedValue(new Error('The request is no longer in a state that allows this.'));
    await user.click(screen.getByRole('button', { name: 'WR-1042' }));
    const drawer = await dialog('WR-1042');
    await user.click(within(drawer).getByRole('button', { name: 'Approve' }));
    const alert = await within(drawer).findByRole('alert');
    expect(alert).toHaveTextContent('The request is no longer in a state that allows this.');
    expect(onError).not.toHaveBeenCalled();
    expect(onMsg).not.toHaveBeenCalled();
    // Nothing changed: the same steps are there to try again.
    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('turns a request down with a reason, which it will not do without one', async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole('button', { name: 'WR-1042' }));
    const drawer = await dialog('WR-1042');
    await user.click(within(drawer).getByRole('button', { name: 'Reject' }));
    const modal = await screen.findByRole('dialog', { name: 'Reject request' });
    const confirm = within(modal).getByRole('button', { name: 'Reject' });
    expect(confirm).toBeDisabled();
    await user.type(within(modal).getByRole('textbox'), '  Account does not match  ');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(post).toHaveBeenCalledWith('/admin/wallet-requests/req-1042/reject', {
      reason: 'Account does not match',
    });
    await within(drawer).findByText('Request WR-1042: Rejected.');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reject request' })).toBeNull(),
    );
  });

  it('completes a cash-out only once it has been told what it is about to do, and records the payout reference given', async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole('button', { name: 'WR-1039' }));
    const drawer = await dialog('WR-1039');
    await user.click(within(drawer).getByRole('button', { name: 'Complete and move money' }));
    const modal = await screen.findByRole('dialog', { name: 'Complete request' });
    expect(modal).toHaveTextContent('Completing WR-1039 records a $2,350.00 movement');
    expect(modal).toHaveTextContent('Yael Mizrahi');
    expect(post).not.toHaveBeenCalled();
    await user.type(within(modal).getByLabelText('Payout reference'), 'PP-7741');
    await user.click(within(modal).getByRole('button', { name: 'Complete and move money' }));
    expect(post).toHaveBeenCalledWith('/admin/wallet-requests/req-1039/complete', {
      payoutReference: 'PP-7741',
    });
    await within(drawer).findByText('Request WR-1039: Completed.');
  });

  it('asks a cash-in for no payout reference', async () => {
    const user = userEvent.setup();
    await desk();
    await user.click(screen.getByRole('button', { name: 'WR-1038' }));
    const drawer = await dialog('WR-1038');
    await user.click(within(drawer).getByRole('button', { name: 'Complete and move money' }));
    const modal = await screen.findByRole('dialog', { name: 'Complete request' });
    expect(within(modal).queryByLabelText('Payout reference')).toBeNull();
    await user.click(within(modal).getByRole('button', { name: 'Complete and move money' }));
    expect(post).toHaveBeenCalledWith('/admin/wallet-requests/req-1038/complete', {});
  });

  it('checks the payouts that are pending from the head of the desk, and says what it found on the page', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ checked: 3, succeeded: 2, failed: 1, pending: 0 });
    await desk();
    await user.click(screen.getByRole('button', { name: 'Check pending payouts' }));
    expect(post).toHaveBeenCalledWith('/admin/payouts/reconcile', {});
    await waitFor(() =>
      expect(onMsg).toHaveBeenCalledWith(
        'Checked 3 payouts: 2 paid, 1 failed and returned, 0 still pending.',
      ),
    );
  });
});

describe.skipIf(!browser)('the desk, in a browser', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const locale of ['en', 'he'] as const) {
      it(`the roll is read, reached and drawn without a flag: ${theme}, ${locale}, desktop and phone`, async () => {
        localStorage.setItem('bault.locale', locale);
        const { unmount } = render(wrap());
        await waitFor(() => expect(groups().length).toBe(3));
        for (const width of [1280, 390]) {
          const page = await inBrowser(width, locale, theme);
          expect(await audit.auditButtons(page)).toEqual([]);
          const flags = await audit.audit(page);
          expect(flags.filter((f) => !/^enum names on screen/.test(f))).toEqual([]);
          await page.context().close();
        }
        unmount();
      });

      it(`a request, opened, is paper on the room, edged and reached: ${theme}, ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        const user = userEvent.setup();
        render(wrap());
        await waitFor(() => expect(groups().length).toBe(3));
        await user.click(screen.getByRole('button', { name: 'WR-1042' }));
        await dialog('WR-1042');
        await waitFor(() => expect(document.querySelector('.desk-next')).not.toBeNull());
        for (const width of [1280, 390]) {
          // A page made from the markup has no script, so what the app does to a drawer whose body scrolls and has
          // no control in it (it becomes the stop: drawer-scroll.test.tsx) does not run here. In a wider font than
          // the page's own, which is not loaded in a page like this, a settled request is taller than a thousand
          // pixels' room, and axe is right that its body is a box the keyboard cannot scroll. This is a test of
          // paper, edges and reach, so the window is tall enough that the body does not scroll in any font.
          const page = await inBrowser(width, locale, theme, 1800);
          const paper = await page.$eval('.drawer .drawer-tag', (el) => {
            const style = getComputedStyle(el);
            return { bg: style.backgroundColor, color: style.color };
          });
          expect(paper).toEqual({ bg: 'rgb(243, 239, 230)', color: 'rgb(21, 19, 15)' });
          expect(await audit.auditButtons(page)).toEqual([]);
          const flags = await audit.audit(page);
          expect(flags.filter((f) => !/^enum names on screen/.test(f))).toEqual([]);
          await page.context().close();
        }
      });
    }
  }

  it('is a card to a phone: the number and the sum on the first line, whose it is and where it stands on the second', async () => {
    render(wrap());
    await waitFor(() => expect(groups().length).toBe(3));
    const page = await inBrowser(390, 'en', 'dark');
    const card = await page.$eval('tr.roll-line', (tr) => {
      const rect = (sel: string) => {
        const box = tr.querySelector(sel)!.getBoundingClientRect();
        return {
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          left: box.left,
          right: box.right,
        };
      };
      const row = tr.getBoundingClientRect();
      return {
        display: getComputedStyle(tr).display,
        request: rect('.roll-cell--request'),
        amount: rect('.roll-cell--amount'),
        customer: rect('.roll-cell--customer'),
        status: rect('.roll-cell--status'),
        created: rect('.roll-cell--created'),
        height: Math.round(row.height),
        labels: Array.from(tr.querySelectorAll('td')).map(
          (td) => getComputedStyle(td, '::before').display,
        ),
        sideways: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(card.display).toBe('grid');
    // Beside one another is sharing a line: a name that wraps in a wider font is a taller cell with the status
    // centred against it, which is not the status on a line of its own.
    const beside = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) =>
      a.top < b.bottom && b.top < a.bottom;
    // First line: the number, and the sum at its end.
    expect(beside(card.request, card.amount)).toBe(true);
    expect(card.amount.left).toBeGreaterThan(card.request.left);
    // Second line: whose it is, and where it stands at its end; third: when.
    expect(card.customer.top).toBeGreaterThanOrEqual(card.request.bottom - 1);
    expect(beside(card.customer, card.status)).toBe(true);
    expect(card.status.left).toBeGreaterThan(card.customer.left);
    expect(card.created.top).toBeGreaterThanOrEqual(card.customer.bottom - 1);
    // A card, not a stack of five labelled rows: a request is about 140px, not 330, and there is no label per value.
    expect(card.height).toBeLessThan(180);
    expect(card.labels.every((d) => d === 'none')).toBe(true);
    expect(card.sideways).toBeLessThanOrEqual(0);
    await page.context().close();
  });

  it('keeps a long account number whole, under its name, rather than breaking it among its digits', async () => {
    const user = userEvent.setup();
    render(wrap());
    await waitFor(() => expect(groups().length).toBe(3));
    await user.click(screen.getByRole('button', { name: 'WR-1036' }));
    await dialog('WR-1036');
    await waitFor(() => expect(document.querySelector('.drawer-tag-lines')).not.toBeNull());
    const page = await inBrowser(390, 'en', 'dark');
    const account = await page.$eval('.drawer-tag-lines', (dl) => {
      const line = Array.from(dl.querySelectorAll('.ledger-line')).find((l) =>
        /Destination account/.test(l.querySelector('dt')?.textContent ?? ''),
      )!;
      const code = line.querySelector('.code-inline')!;
      const label = line.querySelector('dt')!;
      return {
        runs: code.getClientRects().length,
        labelLines: Math.round(
          label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight),
        ),
        codeTop: code.getBoundingClientRect().top,
        labelBottom: label.getBoundingClientRect().bottom,
        codeEnd: code.getBoundingClientRect().right,
        lineEnd: line.getBoundingClientRect().right,
      };
    });
    expect(account.runs).toBe(1);
    expect(account.labelLines).toBe(1);
    expect(account.codeTop).toBeGreaterThanOrEqual(account.labelBottom - 1);
    // It hangs from the end of the line, as every value on the tag does.
    expect(Math.abs(account.lineEnd - account.codeEnd)).toBeLessThanOrEqual(2);
    await page.context().close();
  });
});
