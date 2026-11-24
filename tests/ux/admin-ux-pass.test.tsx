import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');
const { SignInsSection } = await import('../../apps/web/src/areas/admin/SignInsSection');
const { DisputesSection } = await import('../../apps/web/src/areas/admin/DisputesSection');
const { AccountingSection, exportRangeProblem } =
  await import('../../apps/web/src/areas/admin/AccountingSection');
const { HouseStoreSection } = await import('../../apps/web/src/areas/admin/HouseStoreSection');
const { WalletRequestsSection } =
  await import('../../apps/web/src/areas/admin/WalletRequestsSection');
const { OutboxSection } = await import('../../apps/web/src/areas/admin/OutboxSection');
const { StorageFeesSection } = await import('../../apps/web/src/areas/admin/StorageFeesSection');
const { ShelfYieldPanel } = await import('../../apps/web/src/areas/admin/ShelfYieldPanel');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const inI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);
const noop = () => {};

const user = (n: number, over: Record<string, unknown> = {}) => ({
  id: `u${n}`,
  email: `person${n}@bault.dev`,
  username: `person${n}`,
  firstName: `First${n}`,
  lastName: `Last${n}`,
  nameReviewRequired: false,
  role: 'user',
  status: 'active',
  autoSuspended: false,
  intakeId: null,
  mfaEnabled: false,
  ...over,
});

const USERS = [
  user(1, { firstName: 'Zed', lastName: 'Alpha' }),
  user(2, { firstName: 'Dana', lastName: 'Okonkwo', status: 'suspended' }),
  user(3, { firstName: 'Hermon', lastName: 'Levi', role: 'warehouse_operator' }),
];

const ITEMS = [
  {
    id: 'i1',
    serialNumber: 'SN-AAA-0001',
    barcode: 'SN-AAA-0001',
    typeClass: 'trading_card',
    description: 'Rayquaza ex · dragon',
    conditionGrade: 'PSA 9',
    lifecycleState: 'stored',
    holdFlag: false,
    binId: null,
    ownerId: 'u1',
    ownerEmail: 'person1@bault.dev',
  },
  {
    id: 'i2',
    serialNumber: 'SN-BBB-0002',
    barcode: 'SN-BBB-0002',
    typeClass: 'trading_card',
    description: 'Rayquaza VMAX · evolving skies',
    conditionGrade: null,
    lifecycleState: 'stored',
    holdFlag: true,
    binId: null,
    ownerId: 'u2',
    ownerEmail: 'person2@bault.dev',
  },
];

function consoleApi(overrides: Record<string, unknown> = {}) {
  get.mockImplementation(async (path: string) => {
    if (path in overrides) {
      const value = overrides[path];
      if (value instanceof Error) throw value;
      return value;
    }
    if (path === '/admin/users') return USERS;
    if (path === '/admin/items') return ITEMS;
    return [];
  });
}

const bodyRows = () =>
  Array.from(document.querySelectorAll('.data-table tbody tr')) as HTMLElement[];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  window.location.hash = '';
});

describe('the accounts roll can be searched, filtered and sorted', () => {
  it('narrows to what is typed, says how many of how many, and Escape clears it', async () => {
    consoleApi();
    window.location.hash = '#/admin/users';
    const u = userEvent.setup();
    inI18n(<AdminConsole currentUserId="u9" />);
    await screen.findByRole('button', { name: 'Dana Okonkwo' });
    expect(bodyRows()).toHaveLength(3);
    expect(screen.getByText('3 in all')).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: /search by name, username or email/i });
    await u.type(search, 'person3');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('Hermon Levi');
    expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();

    await u.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(bodyRows()).toHaveLength(3);
  });

  it('says when nothing matches and offers the way back', async () => {
    consoleApi();
    window.location.hash = '#/admin/users';
    const u = userEvent.setup();
    inI18n(<AdminConsole currentUserId="u9" />);
    await screen.findByRole('button', { name: 'Dana Okonkwo' });
    await u.type(screen.getByRole('searchbox'), 'nobody-here');
    expect(screen.getByText('Nothing matches “nobody-here”.')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(bodyRows()).toHaveLength(3);
  });

  it('filters by status and sorts by name or with held accounts first', async () => {
    consoleApi();
    window.location.hash = '#/admin/users';
    const u = userEvent.setup();
    inI18n(<AdminConsole currentUserId="u9" />);
    await screen.findByRole('button', { name: 'Dana Okonkwo' });

    await u.selectOptions(
      screen.getByRole('combobox', { name: 'Show accounts that are' }),
      'suspended',
    );
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('Dana Okonkwo');
    await u.selectOptions(screen.getByRole('combobox', { name: 'Show accounts that are' }), 'all');

    await u.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name');
    expect(bodyRows().map((r) => r.querySelector('.register-link')?.textContent)).toEqual([
      'Dana Okonkwo',
      'Hermon Levi',
      'Zed Alpha',
    ]);
    await u.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'status');
    expect(bodyRows()[0]).toHaveTextContent('Dana Okonkwo');
  });

  it('tells a list that could not be loaded in the list, with a retry that loads it again', async () => {
    consoleApi({ '/admin/users': new Error('The server is down.') });
    window.location.hash = '#/admin/users';
    const u = userEvent.setup();
    inI18n(<AdminConsole currentUserId="u9" />);
    const panel = (await screen.findByText('This list could not be loaded.')).closest('section')!;
    expect(within(panel).getByText('The server is down.')).toBeInTheDocument();
    expect(screen.queryByText('No accounts to show.')).toBeNull();

    consoleApi();
    await u.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Dana Okonkwo' })).toBeInTheDocument();
  });

  it('says under the first name why an account cannot be saved without one', async () => {
    consoleApi();
    window.location.hash = '#/admin/users?user=u3';
    const u = userEvent.setup();
    inI18n(<AdminConsole currentUserId="u9" />);
    const first = await screen.findByRole('textbox', { name: 'First name' });
    await u.clear(first);
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a first name: every account keeps one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('does not carry a saved message over to another tab', async () => {
    consoleApi();
    patch.mockResolvedValue(null);
    window.location.hash = '#/admin/users?user=u3';
    const u = userEvent.setup();
    inI18n(<AdminConsole currentUserId="u9" />);
    const last = await screen.findByRole('textbox', { name: 'Last name' });
    await u.clear(last);
    await u.type(last, 'Levy');
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getAllByText('Saved: person3@bault.dev').length).toBeGreaterThan(0),
    );

    window.location.hash = '#/admin/items';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await screen.findByRole('button', { name: 'Rayquaza ex' });
    expect(screen.queryByText('Saved: person3@bault.dev')).toBeNull();
  });
});

describe('the items roll can be searched and filtered', () => {
  it('finds an item by its serial, and shows only what is on hold when asked', async () => {
    consoleApi();
    window.location.hash = '#/admin/items';
    const u = userEvent.setup();
    inI18n(<AdminConsole currentUserId="u9" />);
    await screen.findByRole('button', { name: 'Rayquaza ex' });
    expect(bodyRows()).toHaveLength(2);

    await u.type(screen.getByRole('searchbox'), 'bbb-0002');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('Rayquaza VMAX');
    await u.clear(screen.getByRole('searchbox'));

    await u.click(screen.getByRole('checkbox', { name: 'On hold only' }));
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('Rayquaza VMAX');
  });
});

const LOG = {
  since: '2026-09-18T00:00:00.000Z',
  last24h: { successes: 1, failures: 1, failingAddresses: 1 },
  suspicious: [],
  attempts: [
    {
      id: 'a1',
      occurredAt: '2026-09-18T12:00:00.000Z',
      outcome: 'bad_credentials',
      identifier: 'eldar@bault.dev',
      userId: 'u-e',
      ip: '203.0.113.7',
      userAgent: 'curl/8.10.1',
      username: 'eldar',
      email: 'eldar@bault.dev',
      role: 'admin',
    },
    {
      id: 'a2',
      occurredAt: '2026-09-18T10:00:00.000Z',
      outcome: 'success',
      identifier: 'red@bault.dev',
      userId: 'u-r',
      ip: '198.51.100.4',
      userAgent: null,
      username: 'red',
      email: 'red@bault.dev',
      role: 'user',
    },
  ],
};

describe('the sign-in log can be searched and filtered', () => {
  it('narrows by outcome and by address', async () => {
    get.mockResolvedValue(LOG);
    const u = userEvent.setup();
    inI18n(<SignInsSection />);
    await screen.findByText('@red');
    await u.selectOptions(screen.getByRole('combobox', { name: 'Show the outcome' }), 'success');
    expect(screen.queryByText('@eldar')).toBeNull();
    expect(screen.getByText('@red')).toBeInTheDocument();
    await u.selectOptions(screen.getByRole('combobox', { name: 'Show the outcome' }), 'all');
    await u.type(screen.getByRole('searchbox'), '203.0.113');
    expect(screen.getByText('@eldar')).toBeInTheDocument();
    expect(screen.queryByText('@red')).toBeNull();
  });

  it('does not pass a failed load off as an empty log', async () => {
    get.mockRejectedValueOnce(new Error('Gateway timeout'));
    const u = userEvent.setup();
    inI18n(<SignInsSection />);
    expect(await screen.findByText('This list could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No sign-in attempts recorded yet.')).toBeNull();
    get.mockResolvedValue(LOG);
    await u.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('@red')).toBeInTheDocument();
  });
});

const DISPUTE = {
  id: 'd0000001-aaaa',
  transactionId: 't0000001-bbbb',
  status: 'investigating',
  ruling: null,
  note: 'Corner nicked',
  createdAt: '2026-11-01T10:00:00.000Z',
};
const TX = {
  id: 't0000001-bbbb',
  type: 'sale',
  price: 26000,
  buyerId: 'u1',
  sellerId: 'u2',
  createdAt: '2026-10-30T10:00:00.000Z',
};

function disputesApi() {
  get.mockImplementation(async (path: string) =>
    path === '/admin/disputes' ? [DISPUTE] : path === '/admin/transactions' ? [TX] : [],
  );
}

describe('disputes', () => {
  it('names a transaction in words and a formatted sum, not as raw codes', async () => {
    disputesApi();
    inI18n(<DisputesSection onMsg={noop} onError={noop} />);
    const option = await screen.findByRole('option', { name: /t0000001/ });
    expect(option.textContent).toBe('t0000001 · Sale · $260.00 · Oct 30, 2026');
  });

  it('offers Update only once something changed, and asks for the ruling before Ruled', async () => {
    disputesApi();
    patch.mockResolvedValue(null);
    const onMsg = vi.fn();
    const u = userEvent.setup();
    inI18n(<DisputesSection onMsg={onMsg} onError={noop} />);
    const update = await screen.findByRole('button', { name: 'Update' });
    expect(update).toBeDisabled();

    const status = screen.getByRole('combobox', { name: 'Status' });
    await u.selectOptions(status, 'ruled');
    expect(update).toBeEnabled();
    await u.click(update);
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Ruling' })).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('Write the ruling before marking the dispute ruled.'),
    ).toBeInTheDocument();

    await u.type(screen.getByRole('textbox', { name: 'Ruling' }), 'Refund the buyer{Enter}');
    expect(patch).toHaveBeenCalledWith('/admin/disputes/d0000001-aaaa', {
      status: 'ruled',
      ruling: 'Refund the buyer',
    });
    await waitFor(() =>
      expect(onMsg).toHaveBeenCalledWith(
        'Dispute updated: it is now Ruled, as its file below shows.',
      ),
    );
  });

  it('says beside the button why a dispute cannot be opened yet', async () => {
    disputesApi();
    inI18n(<DisputesSection onMsg={noop} onError={noop} />);
    expect(
      await screen.findByText('Pick the transaction the dispute is about first.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open dispute' })).toBeDisabled();
  });
});

describe('accounting', () => {
  it('knows a range the export would refuse', () => {
    expect(exportRangeProblem('2026-11-01', '2026-11-23')).toBeNull();
    expect(exportRangeProblem('2026-11-23', '2026-11-01')).toBe('backwards');
    expect(exportRangeProblem('2025-01-01', '2026-11-23')).toBe('tooLong');
    expect(exportRangeProblem('', '2026-11-23')).toBe('missing');
  });

  it('does not offer a download for a backwards range, and says why', async () => {
    const u = userEvent.setup();
    inI18n(<AccountingSection />);
    const from = screen.getByLabelText('From');
    await u.clear(from);
    await u.type(from, '2099-01-01');
    expect(
      screen.getByText('The start date is after the end date. Pick a start on or before the end.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download csv/i })).toBeNull();
    expect(screen.getByRole('button', { name: /download csv/i })).toBeDisabled();
  });

  it('tells a summary that failed in its own panel, with a retry', async () => {
    get.mockRejectedValueOnce(new Error('Ledger busy'));
    const u = userEvent.setup();
    inI18n(<AccountingSection />);
    await u.click(screen.getByRole('button', { name: 'Show summary' }));
    expect(await screen.findByText('Ledger busy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

const PRODUCTS = [
  {
    id: 'p1',
    code: 'HSE-1',
    typeClass: 'trading_card',
    description: 'Booster box',
    conditionGrade: null,
    photoRef: null,
    askingPrice: 12000,
    stock: 3,
    status: 'active',
  },
  {
    id: 'p2',
    code: 'HSE-2',
    typeClass: 'trading_card',
    description: 'Sleeves',
    conditionGrade: null,
    photoRef: null,
    askingPrice: 500,
    stock: 0,
    status: 'active',
  },
];

describe('the house store', () => {
  it('finds a product by its code and filters by standing', async () => {
    get.mockResolvedValue(PRODUCTS);
    const u = userEvent.setup();
    inI18n(<HouseStoreSection onMsg={noop} onError={noop} />);
    await screen.findByText('Booster box', { selector: 'bdi' });
    await u.type(screen.getByRole('searchbox'), 'hse-2');
    expect(screen.queryByText('Booster box', { selector: 'bdi' })).toBeNull();
    await u.clear(screen.getByRole('searchbox'));
    await u.selectOptions(
      screen.getByRole('combobox', { name: 'Show products that are' }),
      'soldOut',
    );
    expect(screen.queryByText('Booster box', { selector: 'bdi' })).toBeNull();
    expect(screen.getByText('Sleeves', { selector: 'bdi' })).toBeInTheDocument();
  });

  it('says what is missing beside the add button, and names the new product by its code', async () => {
    get.mockResolvedValue([]);
    post.mockResolvedValue({ code: 'HSE-9' });
    const onMsg = vi.fn();
    const u = userEvent.setup();
    inI18n(<HouseStoreSection onMsg={onMsg} onError={noop} />);
    expect(
      await screen.findByText(
        'Write a description, a price above zero and at least one copy to add it.',
      ),
    ).toBeInTheDocument();
    await u.type(screen.getByLabelText('Price'), '0');
    expect(
      screen.getByText('Enter a price above zero with at most two decimals, like 24.99.'),
    ).toBeInTheDocument();
    await u.clear(screen.getByLabelText('Price'));
    await u.type(screen.getByLabelText('Price'), '24.99');
    await u.type(screen.getByLabelText(/^Description/), 'Playmat');
    await u.click(screen.getByRole('button', { name: 'Add to store' }));
    await waitFor(() =>
      expect(onMsg).toHaveBeenCalledWith('Added to the store as HSE-9. Buyers can buy it now.'),
    );
  });
});

describe('the wallet desk', () => {
  it('finds a request by its code or its customer', async () => {
    const at = '2026-11-20T10:00:00.000Z';
    const base = {
      userId: 'x',
      status: 'submitted',
      amount: 1000,
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
      createdAt: at,
      updatedAt: at,
    };
    get.mockResolvedValue([
      {
        ...base,
        id: 'r1',
        code: 'WR-1001',
        type: 'cash_in',
        username: 'dana',
        customerName: 'Dana Levi',
        email: 'dana@x.dev',
      },
      {
        ...base,
        id: 'r2',
        code: 'WR-2002',
        type: 'cash_out',
        username: 'noam',
        customerName: 'Noam Katz',
        email: 'noam@x.dev',
      },
    ]);
    const u = userEvent.setup();
    inI18n(<WalletRequestsSection currentUserId="me" onMsg={noop} onError={noop} />);
    await screen.findByText('WR-1001');
    await u.type(screen.getByRole('searchbox'), 'noam');
    expect(screen.queryByText('WR-1001')).toBeNull();
    expect(screen.getByText('WR-2002')).toBeInTheDocument();
  });
});

describe('lists that could not be loaded say so, with a retry', () => {
  it('the parked messages', async () => {
    get.mockRejectedValueOnce(new Error('Down'));
    inI18n(<OutboxSection onMsg={noop} onError={noop} />);
    expect(await screen.findByText('This list could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is parked/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('the storage fee runs', async () => {
    get.mockRejectedValueOnce(new Error('Down'));
    inI18n(<StorageFeesSection />);
    expect(await screen.findByText('This list could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No runs yet.')).toBeNull();
  });
});

describe('the shelf yield', () => {
  it('sorts the shelves and finds one by its number', async () => {
    const shelf = (n: number, perMonth: number) => ({
      binId: `b${n}`,
      serialNumber: `BIN-${n}`,
      zone: 'A',
      facilityCode: 'NJ',
      oversized: false,
      active: true,
      itemCount: n,
      slotDays: 30,
      revenueMinor: perMonth,
      revenuePerSlotMonthMinor: perMonth,
      deadItemCount: 0,
      oldestItemDays: 10,
    });
    get.mockImplementation(async (path: string) =>
      path === '/admin/shelf-yield'
        ? {
            shelves: [shelf(1, 100), shelf(2, 900), shelf(3, 400)],
            totals: {
              shelfCount: 3,
              occupiedShelfCount: 3,
              emptyShelfCount: 0,
              itemCount: 6,
              deadItemCount: 0,
              revenueMinor: 1400,
              slotDays: 90,
            },
          }
        : [],
    );
    const u = userEvent.setup();
    inI18n(<ShelfYieldPanel />);
    await screen.findByText('BIN-2');
    const shelves = () =>
      Array.from(document.querySelectorAll('.mono')).map((el) => el.textContent);
    expect(shelves()).toEqual(['BIN-1', 'BIN-3', 'BIN-2']);
    await u.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'yieldHigh');
    expect(shelves()).toEqual(['BIN-2', 'BIN-3', 'BIN-1']);
    await u.type(screen.getByRole('searchbox'), 'bin-3');
    expect(shelves()).toEqual(['BIN-3']);
  });
});

describe('a new pricing rule', () => {
  it('says under the figure what is wrong with it, and beside the button what is missing', async () => {
    const { billableActions, coverage } =
      await import('../../apps/api/src/modules/prc/billable-actions');
    const { PricingSection } = await import('../../apps/web/src/areas/admin/PricingSection');
    const unpriced = JSON.parse(JSON.stringify(coverage(billableActions(), [])));
    get.mockImplementation(async (path: string) =>
      path === '/admin/pricing/coverage' ? unpriced : [],
    );
    const u = userEvent.setup();
    inI18n(<PricingSection onMsg={noop} onError={noop} />);
    expect(
      await screen.findByText('Name the rule and give it a figure to add it.'),
    ).toBeInTheDocument();
    await u.type(screen.getByLabelText('Flat amount'), '0');
    expect(screen.getByLabelText('Flat amount')).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('Enter an amount above zero with at most two decimals, like 2.50.'),
    ).toBeInTheDocument();
  });
});
