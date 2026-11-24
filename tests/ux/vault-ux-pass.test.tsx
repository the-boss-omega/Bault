import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();

class FakeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: FakeApiError,
}));

vi.mock('../../apps/web/src/shared/Barcode', () => ({
  Barcode: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodeLabel: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodePrintButton: () => <button type="button">Print</button>,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { VaultPage, sortVaultItems } =
  await import('../../apps/web/src/areas/customer/vault/VaultPage');
const { RemoveCommonsPanel } =
  await import('../../apps/web/src/areas/customer/vault/RemoveCommonsPanel');
const { InboundPage, RegisterParcelForm } =
  await import('../../apps/web/src/areas/customer/inbound/InboundPage');
const { NotificationsPage } =
  await import('../../apps/web/src/areas/customer/notifications/NotificationsPage');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  window.location.hash = '';
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  serialNumber: `SN-TEST-${id}`,
  typeClass: 'trading_card',
  description: `Card ${id}`,
  conditionGrade: 'Raw',
  lifecycleState: 'stored',
  holdFlag: false,
  isLot: false,
  lotSize: 1,
  lotBroken: false,
  receivedAt: daysAgo(5),
  ...over,
});

const ZETA = item('0001', { description: 'Zeta card', receivedAt: daysAgo(40) });
const ALPHA = item('0002', { description: 'Alpha card', receivedAt: daysAgo(2) });
const LISTED = item('0003', {
  description: 'Mid card',
  lifecycleState: 'listed',
  receivedAt: daysAgo(10),
});

function vaultApi(items: unknown[], extra: (path: string) => unknown = () => undefined) {
  get.mockImplementation((path: string) => {
    const special = extra(path);
    if (special !== undefined) return special;
    if (path.endsWith('/timeline')) return Promise.resolve([]);
    if (path.endsWith('/storage')) return Promise.reject(new Error('no storage here'));
    if (path.startsWith('/vault/items/')) return Promise.resolve({ images: [], openRequests: [] });
    if (path.startsWith('/vault/items')) return Promise.resolve(items);
    if (path.startsWith('/vault/counts'))
      return Promise.resolve({ active: items.length, hold: 0, history: 0 });
    if (path.startsWith('/services/remove-commons/window'))
      return Promise.resolve({ windowDays: 30 });
    return Promise.resolve([]);
  });
}

const SERIAL_0004 = 'SN-TEST-0004';

const serialsOnScreen = () =>
  Array.from(document.querySelectorAll('.card-grid .card-title')).map((el) => el.textContent);

describe('the vault grid can be sorted, and keeps its place when the list grows', () => {
  it('sorts newest first by default and by name when asked', async () => {
    window.location.hash = '#/vault';
    vaultApi([ZETA, ALPHA, LISTED]);
    renderIn(<VaultPage />);
    await waitFor(() => expect(serialsOnScreen()).toHaveLength(3));
    expect(serialsOnScreen()).toEqual(['SN-TEST-0002', 'SN-TEST-0003', 'SN-TEST-0001']);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name');
    await waitFor(() =>
      expect(serialsOnScreen()).toEqual(['SN-TEST-0002', 'SN-TEST-0003', 'SN-TEST-0001']),
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'oldest');
    await waitFor(() =>
      expect(serialsOnScreen()).toEqual(['SN-TEST-0001', 'SN-TEST-0003', 'SN-TEST-0002']),
    );
    expect(window.location.hash).toContain('sort=oldest');
  });

  it('sorts a departed item by the day it left', () => {
    const gone = [
      item('a', { historical: true, departedAt: daysAgo(1), receivedAt: daysAgo(100) }),
      item('b', { historical: true, departedAt: daysAgo(9), receivedAt: daysAgo(2) }),
    ];
    expect(sortVaultItems(gone, 'newest', (i) => i.description).map((i) => i.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('opens with the search a link asked for', async () => {
    window.location.hash = '#/vault?q=SN-TEST-0002';
    vaultApi([ALPHA]);
    renderIn(<VaultPage />);
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining('q=SN-TEST-0002')),
    );
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('SN-TEST-0002');
  });
});

describe('a vault that did not load says so and offers to try again', () => {
  it('shows the failure with a retry, never the empty vault, and loads again on retry', async () => {
    window.location.hash = '#/vault';
    let fail = true;
    vaultApi([ALPHA], (path) =>
      fail && path.startsWith('/vault/items')
        ? Promise.reject(new Error('Network down'))
        : undefined,
    );
    renderIn(<VaultPage />);
    expect(await screen.findByText('Your vault could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('Nothing in your vault yet')).toBeNull();

    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(serialsOnScreen()).toEqual(['SN-TEST-0002']));
    expect(screen.queryByText('Your vault could not be loaded')).toBeNull();
  });
});

describe('picking items to ship', () => {
  it('picks every item that can ship in one press, and leaves the rest', async () => {
    window.location.hash = '#/vault';
    vaultApi([ZETA, ALPHA, LISTED]);
    renderIn(<VaultPage />);
    await waitFor(() => expect(serialsOnScreen()).toHaveLength(3));
    await userEvent.click(screen.getByRole('button', { name: 'Select to ship' }));
    expect(
      screen.getByText('Only stored items that are not on hold can be shipped.'),
    ).toBeInTheDocument();

    const bar = screen.getByRole('region', { name: 'Items picked to ship' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Pick all 2 that can ship' }));
    expect(within(bar).getByText('2 picked')).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Ship these' }));
    expect(decodeURIComponent(window.location.hash)).toMatch(
      /shipping-services\/shipping\?items=(0002,0001|0001,0002)$/,
    );
  });
});

describe('the item drawer', () => {
  it('offers to ship a stored item straight from the drawer', async () => {
    window.location.hash = '#/vault?item=0002';
    vaultApi([ALPHA]);
    renderIn(<VaultPage />);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Ship this item' }));
    expect(window.location.hash).toContain('shipping-services/shipping?items=0002');
  });

  it('offers to sell a stored item, opening Sell with that item chosen', async () => {
    window.location.hash = '#/vault?item=0002';
    vaultApi([ALPHA]);
    renderIn(<VaultPage />);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Sell this item' }));
    expect(window.location.hash).toBe('#/marketplace/sell?item=0002');
  });

  it('does not offer to sell a listed item or one on hold', async () => {
    window.location.hash = '#/vault?item=0003';
    vaultApi([LISTED]);
    const { unmount } = renderIn(<VaultPage />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: 'Video review' });
    expect(within(dialog).queryByRole('button', { name: 'Sell this item' })).toBeNull();
    unmount();

    window.location.hash = '#/vault/hold?item=0004';
    vaultApi([item('0004', { holdFlag: true })]);
    renderIn(<VaultPage />);
    const held = await screen.findByRole('dialog');
    await within(held).findByText(SERIAL_0004);
    expect(within(held).queryByRole('button', { name: 'Sell this item' })).toBeNull();
  });

  it('does not offer shipping for a listed item', async () => {
    window.location.hash = '#/vault?item=0003';
    vaultApi([LISTED]);
    renderIn(<VaultPage />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: 'Video review' });
    expect(within(dialog).queryByRole('button', { name: 'Ship this item' })).toBeNull();
  });

  it('says the history did not load and retries, instead of saying nothing happened', async () => {
    window.location.hash = '#/vault?item=0002';
    let fail = true;
    vaultApi([ALPHA], (path) => {
      if (path.endsWith('/timeline')) {
        return fail
          ? Promise.reject(new Error('down'))
          : Promise.resolve([{ at: daysAgo(2), kind: 'intake', params: {} }]);
      }
      return undefined;
    });
    renderIn(<VaultPage />);
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('The history of this item could not be loaded.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Nothing has happened to this item yet.')).toBeNull();
    fail = false;
    const retries = within(dialog).getAllByRole('button', { name: 'Try again' });
    await userEvent.click(retries[retries.length - 1]!);
    await waitFor(() =>
      expect(
        within(dialog).queryByText('The history of this item could not be loaded.'),
      ).toBeNull(),
    );
    expect(within(dialog).queryByText('Nothing has happened to this item yet.')).toBeNull();
  });

  it('says the storage cost did not load, with a retry', async () => {
    window.location.hash = '#/vault?item=0002';
    vaultApi([ALPHA]);
    renderIn(<VaultPage />);
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('The storage cost of this item could not be loaded.'),
    ).toBeInTheDocument();
  });

  it('points a frozen item at support', async () => {
    window.location.hash = '#/vault/hold?item=0002';
    vaultApi([{ ...ALPHA, holdFlag: true }]);
    renderIn(<VaultPage />);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Ask support about this hold' }),
    );
    expect(window.location.hash).toContain('#/support/new');
  });
});

describe('removing commons', () => {
  it('says what to do while nothing is picked, and picks every eligible item in one press', async () => {
    renderIn(
      <RemoveCommonsPanel
        items={[ZETA, ALPHA, item('0004')]}
        windowDays={30}
        onDone={() => {}}
        onError={() => {}}
      />,
    );
    expect(
      screen.getByText('Tick the items you want removed, then press the button.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pick all 2 that can go' }));
    expect(screen.getByRole('button', { name: 'Remove 2 items' })).toBeEnabled();
    expect(
      screen.queryByText('Tick the items you want removed, then press the button.'),
    ).toBeNull();
    const rows = within(screen.getByRole('list', { name: 'Remove commons' })).getAllByRole(
      'listitem',
    );
    expect(rows[rows.length - 1]).toHaveTextContent('Zeta card');
  });
});

const PARCEL = {
  id: 'p1',
  code: 'PKG-AAAA1111',
  status: 'expected',
  carrier: 'USPS',
  trackingNumber: '9400100000000000000001',
  declaredContents: 'Two raw Rayquaza singles',
  internationalOrigin: false,
  expectedAt: daysAgo(3),
  receivedAt: null,
  openedAt: null,
  processedAt: null,
  forwardedAt: null,
  condition: null,
  conditionNotes: null,
  facilityName: 'New Jersey',
};
const SECOND = {
  ...PARCEL,
  id: 'p2',
  code: 'PKG-BBBB2222',
  trackingNumber: '1Z999',
  declaredContents: 'Sealed box',
  carrier: 'UPS',
};
const ADDRESS = { code: 'NJ', name: 'New Jersey', role: 'primary', salesTaxBps: 663, lines: ['x'] };

function inboundApi(parcels: unknown[], failAddresses = { value: false }) {
  get.mockImplementation((path: string) => {
    if (path === '/me/parcels') return Promise.resolve(parcels);
    if (path === '/me/inbound-addresses') {
      return failAddresses.value
        ? Promise.reject(new Error('Addresses down'))
        : Promise.resolve([ADDRESS]);
    }
    return Promise.resolve({
      awaitingOpen: 0,
      awaitingProcessing: 0,
      oldestWaitingHours: null,
      oldestReceivedAt: null,
    });
  });
}

describe('the parcels', () => {
  it('keeps the register form folded away once there are parcels, and opens it on request', async () => {
    window.location.hash = '#/inbound/parcels';
    inboundApi([PARCEL]);
    renderIn(<InboundPage />);
    await screen.findByRole('list', { name: 'Your parcels' });
    expect(screen.queryByRole('button', { name: 'Register parcel' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tell us a parcel is coming' }));
    expect(await screen.findByRole('button', { name: 'Register parcel' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Register parcel' })).toBeNull();
  });

  it('shows the register form at once when there are no parcels yet', async () => {
    window.location.hash = '#/inbound/parcels';
    inboundApi([]);
    renderIn(<InboundPage />);
    expect(await screen.findByRole('button', { name: 'Register parcel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See where to send them' })).toBeInTheDocument();
  });

  it('searches the parcels by tracking number, carrier or contents', async () => {
    window.location.hash = '#/inbound/parcels';
    inboundApi([PARCEL, SECOND]);
    renderIn(<InboundPage />);
    const list = await screen.findByRole('list', { name: 'Your parcels' });
    expect(list.querySelectorAll(':scope > li')).toHaveLength(2);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search parcels' }), 'sealed');
    await waitFor(() => expect(list.querySelectorAll(':scope > li')).toHaveLength(1));
    expect(list).toHaveTextContent('PKG-BBBB2222');
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search parcels' }));
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search parcels' }),
      'nothing like it',
    );
    expect(await screen.findByText('No parcels match')).toBeInTheDocument();
  });

  it('asks before cancelling a registration', async () => {
    window.location.hash = '#/inbound/parcels?parcel=p1';
    inboundApi([PARCEL]);
    post.mockResolvedValue({});
    renderIn(<InboundPage />);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/Next: the warehouse checks it in/)).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Cancel registration' }));
    expect(post).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog', { name: 'Cancel this registration?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel registration' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/me/parcels/p1/cancel'));
  });

  it('puts a duplicate tracking number next to the tracking field', async () => {
    inboundApi([]);
    post.mockRejectedValue(
      new FakeApiError(409, 'Tracking number 1Z999 is already registered as PKG-BBBB2222'),
    );
    renderIn(<RegisterParcelForm onRegistered={async () => {}} onError={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Sent to' })).toHaveValue('NJ'),
    );
    const tracking = screen.getByRole('textbox', { name: /Tracking number/ });
    await userEvent.type(tracking, '1Z999');
    await userEvent.click(screen.getByRole('button', { name: 'Register parcel' }));
    await waitFor(() => expect(tracking).toHaveAttribute('aria-invalid', 'true'));
    expect(tracking).toHaveAccessibleDescription(/already registered as PKG-BBBB2222/);
  });

  it('retries the addresses, not only the parcels, when they did not load', async () => {
    window.location.hash = '#/inbound/addresses';
    const fail = { value: true };
    inboundApi([], fail);
    renderIn(<InboundPage />);
    expect(await screen.findByText('Addresses down')).toBeInTheDocument();
    fail.value = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Copy address' })).toBeInTheDocument();
  });
});

describe('the notifications', () => {
  const note = (id: string, eventType: string, content: unknown) => ({
    id,
    eventType,
    content,
    createdAt: '2026-10-27T12:00:00.000Z',
  });
  const items = [
    note('n1', 'offer_received', { message: 'You received an offer of $2,750.00.' }),
    note('n2', 'item_received', {
      barcode: 'SN-DR97-0001',
      message: 'Item SN-DR97-0001 was received.',
    }),
    note('n3', 'wallet_request_completed', { message: 'Your cash-in was approved.' }),
  ];
  const PREFS = {
    categories: ['custody', 'money'],
    channels: ['in_app', 'email'],
    events: [
      {
        eventType: 'item_received',
        category: 'custody',
        label: 'Item received',
        channels: [
          { channel: 'in_app', enabled: true, isDefault: true, mandatory: false },
          { channel: 'email', enabled: true, isDefault: true, mandatory: false },
        ],
      },
      {
        eventType: 'topup_settled',
        category: 'money',
        label: 'Cash-in settled',
        channels: [
          { channel: 'in_app', enabled: true, isDefault: true, mandatory: false },
          { channel: 'email', enabled: true, isDefault: true, mandatory: false },
        ],
      },
    ],
  };
  const feed = (list: unknown[]) =>
    ({
      items: list,
      error: null,
      loading: false,
      reload: vi.fn(),
      unseen: 0,
      markSeen: vi.fn(),
    }) as never;

  it('filters the feed by kind and by a word', async () => {
    get.mockResolvedValue(PREFS);
    window.location.hash = '#/notifications';
    renderIn(<NotificationsPage feed={feed(items)} onSeen={() => {}} />);
    const entries = () => document.querySelectorAll('.timeline > li');
    await waitFor(() => expect(entries()).toHaveLength(3));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'wallet');
    expect(entries()).toHaveLength(1);
    expect(screen.getByText('1 shown')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'all');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search notifications' }), 'offer');
    expect(entries()).toHaveLength(1);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search notifications' }), 'zzz');
    expect(screen.getByText('No notifications match')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(entries()).toHaveLength(3);
  });

  it('takes a notification about an item to that item in the vault', async () => {
    get.mockResolvedValue(PREFS);
    window.location.hash = '#/notifications';
    renderIn(<NotificationsPage feed={feed(items)} onSeen={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Find it in my vault' }));
    expect(window.location.hash).toBe('#/vault/active?q=SN-DR97-0001');
  });

  it('says a preference was saved, in words', async () => {
    get.mockResolvedValue(PREFS);
    put.mockResolvedValue({});
    window.location.hash = '#/notifications/preferences';
    renderIn(<NotificationsPage feed={feed([])} onSeen={() => {}} />);
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Item received · By email' }),
    );
    expect(put).toHaveBeenCalledWith('/notifications/preferences', {
      eventType: 'item_received',
      channel: 'email',
      enabled: false,
    });
    expect(await screen.findByText('Saved. Item received, By email: off.')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'By email' });
    await userEvent.click(within(group).getByRole('button', { name: 'All on' }));
    expect(put).toHaveBeenCalledWith('/notifications/preferences/channel', {
      channel: 'email',
      enabled: true,
    });
    expect(screen.getByRole('navigation', { name: 'Jump to a group' })).toBeInTheDocument();
  });

  it('retries the preferences too when they did not load', async () => {
    get.mockRejectedValueOnce(new Error('Preferences down')).mockResolvedValue(PREFS);
    window.location.hash = '#/notifications/preferences';
    renderIn(<NotificationsPage feed={feed([])} onSeen={() => {}} />);
    expect(await screen.findByText('Preferences down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('checkbox', { name: 'Item received · By email' }),
    ).toBeInTheDocument();
  });
});
