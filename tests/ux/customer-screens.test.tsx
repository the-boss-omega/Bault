import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

const { I18nProvider, t } = await import('../../apps/web/src/shared/i18n');
const { AccountPill } = await import('../../apps/web/src/shared/ui/PageHeader');
const { IntakePolicyPanel } = await import('../../apps/web/src/areas/customer/help/IntakePolicyPanel');
const { VaultPage } = await import('../../apps/web/src/areas/customer/vault/VaultPage');
const { RemoveCommonsPanel } = await import('../../apps/web/src/areas/customer/vault/RemoveCommonsPanel');
const { WalletPage } = await import('../../apps/web/src/areas/customer/finance/WalletPage');
const { ShowPickupPanel, WhiteGlovePanel, WhiteGloveQuotes } = await import('../../apps/web/src/areas/customer/shipping/HumanFulfilmentPanels');
const { RechooseService, ShipmentDrawer } = await import('../../apps/web/src/areas/customer/shipping/ShippingServicesPage');
const { useI18n } = await import('../../apps/web/src/shared/i18n');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  window.location.hash = '';
});

describe('the account pill in the header', () => {
  it('shows the username — the identifier that goes on a parcel — with the role beside it', () => {
    renderIn(<AccountPill username="red" roleLabel="Collector" suspended={false} />);
    expect(screen.getByText('@red')).toBeInTheDocument();
    expect(screen.getByText('Collector')).toBeInTheDocument();
  });

  it('says the account is suspended, and does not then show a username as if nothing were wrong', () => {
    renderIn(<AccountPill username="red" roleLabel="Collector" suspended />);
    expect(screen.getByText(/account suspended/i)).toBeInTheDocument();
    expect(screen.queryByText('@red')).not.toBeInTheDocument();
  });

  it('falls back to the role for the one frame after sign-in where the username is not loaded yet', () => {
    renderIn(<AccountPill roleLabel="Collector" suspended={false} />);
    expect(screen.getByText('Collector')).toBeInTheDocument();
    expect(screen.queryByText('@')).not.toBeInTheDocument();
  });
});

describe('the published intake policy', () => {
  const POLICY = {
    acceptedClasses: [
      { key: 'trading_card', label: 'Trading card', oversized: false, lotEligible: true, lotMinSize: 6, typicalWeightGrams: 5 },
      { key: 'sealed_case', label: 'Sealed case', oversized: true, lotEligible: false, typicalWeightGrams: 6000 },
    ],
    refusedCategories: [
      { key: 'gps_tracker', label: 'GPS tracker', prohibited: true, reason: 'A tracker is a powered radio transmitter and cannot be stored.' },
      { key: 'no_value', label: 'No processing value', prohibited: false, reason: 'Not a refusal. Some arrivals cost more to process than they are worth.' },
    ],
    outcomes: ['destroyed', 'given_away', 'recycled', 'returned'],
    lotThreshold: 6,
    rules: [{ id: 'trackers', heading: 'Do not put a tracker in a parcel you send us', body: 'One found in an arriving parcel is removed and destroyed.' }],
  };

  it('renders what the API publishes, rather than a copy of the rules', async () => {
    get.mockResolvedValue(POLICY);
    renderIn(<IntakePolicyPanel />);

    expect(await screen.findByText('Trading card')).toBeInTheDocument();
    expect(screen.getByText('Sealed case')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/content/intake-policy');
  });

  it('separates a safety refusal from a judgement about value', async () => {
    get.mockResolvedValue(POLICY);
    renderIn(<IntakePolicyPanel />);
    await screen.findByText('Trading card');

    const refused = screen.getByRole('heading', { name: /will not go into a vault/i }).closest('section')!;
    expect(within(refused).getByText('GPS tracker')).toBeInTheDocument();
    expect(within(refused).queryByText('No processing value')).not.toBeInTheDocument();

    const judgement = screen.getByRole('heading', { name: /not worth storing/i }).closest('section')!;
    expect(within(judgement).getByText('No processing value')).toBeInTheDocument();
  });

  it('marks which storage terms each class falls under', async () => {
    get.mockResolvedValue(POLICY);
    renderIn(<IntakePolicyPanel />);
    await screen.findByText('Trading card');
    expect(screen.getByText('Oversized')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
  });

  it('states the lot threshold rather than leaving it to be discovered', async () => {
    get.mockResolvedValue(POLICY);
    renderIn(<IntakePolicyPanel />);
    await screen.findByText('Trading card');
    expect(screen.getByText(/6 or more/i)).toBeInTheDocument();
    expect(screen.getByText(/never a lot/i)).toBeInTheDocument();
  });

  it('shows the reason when the policy cannot be loaded, instead of an empty page', async () => {
    get.mockRejectedValue(new Error('The service is unavailable.'));
    renderIn(<IntakePolicyPanel />);
    expect(await screen.findByText(/service is unavailable/i)).toBeInTheDocument();
  });

  it('says it is loading rather than rendering an empty table', () => {
    get.mockReturnValue(new Promise(() => {}));
    renderIn(<IntakePolicyPanel />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('the vault', () => {
  const ITEM = {
    id: 'i1',
    serialNumber: 'SN-DR97-0001',
    barcode: 'SN-DR97-0001',
    typeClass: 'trading_card',
    description: '2003 Pokémon EX Dragon — Rayquaza ex #97/97',
    conditionGrade: 'PSA 9',
    lifecycleState: 'stored',
    binBarcode: 'BIN-QJLTDJH4',
    binZone: 'A',
    receivedAt: '2026-10-01T10:00:00.000Z',
    isLot: false,
    lotSize: 1,
    oversized: false,
  };

  it('lists what the collector owns, with the catalogue detail that identifies it', async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/vault/items') ? [ITEM] : { stored: 1 }),
    );
    renderIn(<VaultPage />);
    await waitFor(() => expect(screen.getAllByText(/Rayquaza ex/).length).toBeGreaterThan(0));
  });

  it('shows no shelf code on a tile, and no shelf, barcode label or print button in the drawer', async () => {
    window.location.hash = '#/vault?item=i1';
    get.mockImplementation((path: string) => {
      if (path.endsWith('/timeline')) return Promise.resolve([]);
      if (path.endsWith('/storage')) return Promise.reject(new Error('no storage in this test'));
      if (path.startsWith('/vault/items/')) return Promise.resolve({ images: [], openRequests: [] });
      if (path.startsWith('/vault/items')) return Promise.resolve([ITEM]);
      return Promise.resolve({ active: 1, hold: 0, history: 0 });
    });
    renderIn(<VaultPage />);
    const dialog = await screen.findByRole('dialog');
    const tile = document.querySelector('.card-where') as HTMLElement;
    expect(tile).toHaveTextContent('In the vault since');
    expect(document.body).not.toHaveTextContent(/BIN-QJLTDJH4|Not on a shelf|Shelf/);
    expect(within(dialog).queryByRole('button', { name: /print/i })).toBeNull();
    expect(dialog.querySelector('svg[aria-label*="SN-DR97-0001"], .barcode-label')).toBeNull();
  });

  it('says the vault is empty rather than rendering a blank frame', async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/vault/items') ? [] : {}),
    );
    renderIn(<VaultPage />);
    await waitFor(() => {
      const empty = screen.queryByText(/nothing (in your vault|to show)|no (active )?(cards|items)/i);
      expect(empty, 'the vault renders no empty state at all').toBeTruthy();
    });
  });

  it('picks several items to ship and opens the shipping form with them', async () => {
    const SECOND = { ...ITEM, id: 'i2', serialNumber: 'SN-CL10-0005', barcode: 'SN-CL10-0005', description: 'Call of Legends Rayquaza' };
    const AWAY = { ...ITEM, id: 'i3', serialNumber: 'SN-GRADE-0001', barcode: 'SN-GRADE-0001', description: 'Away at PSA', lifecycleState: 'at_grader' };
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/vault/items') ? [ITEM, SECOND, AWAY] : { active: 3, hold: 0, history: 0 }),
    );
    window.location.hash = '#/vault';
    renderIn(<VaultPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select to ship' }));

    const bar = screen.getByRole('region', { name: 'Items picked to ship' });
    expect(bar).toHaveTextContent('0 picked');
    expect(within(bar).getByRole('button', { name: 'Ship these' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: /Away at PSA cannot be shipped/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Pick 2003 Pokémon EX Dragon/ }));
    await user.click(screen.getByRole('button', { name: /Pick Call of Legends Rayquaza/ }));
    expect(bar).toHaveTextContent('2 picked');
    expect(screen.getByRole('button', { name: /Pick Call of Legends Rayquaza/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(bar).getByRole('button', { name: 'Ship these' }));
    expect(window.location.hash).toBe('#/shipping-services/shipping?items=i1%2Ci2');
  });

  it('shows the reason the vault could not be loaded', async () => {
    get.mockRejectedValue(new Error('Could not reach the vault.'));
    renderIn(<VaultPage />);
    expect(await screen.findByText(/could not reach the vault/i)).toBeInTheDocument();
  });
});

describe('the vault has a place for every state (F057)', () => {
  const base = {
    barcode: 'SN-X',
    typeClass: 'trading_card',
    conditionGrade: 'Raw',
    binBarcode: null,
    isLot: false,
    lotSize: 1,
    oversized: false,
  };

  it('shows a card away at the grader among the cards the collector holds, saying where it is', async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/vault/items')
          ? [{ ...base, id: 'g1', serialNumber: 'SN-GRADE-0001', description: 'Rayquaza at PSA', lifecycleState: 'at_grader' }]
          : { active: 1, hold: 0, history: 0 },
      ),
    );
    renderIn(<VaultPage />);
    await waitFor(() => expect(screen.getAllByText(/Rayquaza at PSA/).length).toBeGreaterThan(0));
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/vault\/items\?scope=active/));
    expect(screen.getAllByText('At the grader').length).toBeGreaterThan(0);
  });

  it('keeps a discarded card in History, labelled as discarded', async () => {
    window.location.hash = '#/vault/history';
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/vault/items')
          ? [
              {
                ...base,
                id: 'd1',
                serialNumber: 'SN-CULL-0001',
                description: 'Bulk common, culled',
                lifecycleState: 'discarded',
                historical: true,
                departedAt: '2026-10-01T10:00:00.000Z',
                departure: { kind: 'discarded', code: null },
              },
            ]
          : { active: 0, hold: 0, history: 1 },
      ),
    );
    renderIn(<VaultPage />);
    await waitFor(() => expect(screen.getAllByText(/Bulk common, culled/).length).toBeGreaterThan(0));
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/vault\/items\?scope=history/));
    expect(screen.getAllByText(/Discarded/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Discarded at your request').length).toBeGreaterThan(0);
    expect(screen.queryByText(/remove commons/)).toBeNull();
  });
});

describe('removing commons acts only on what is on screen (F056)', () => {
  const recent = new Date().toISOString();
  const card = (id: string, description: string) => ({
    id,
    serialNumber: `SN-${id.toUpperCase()}`,
    typeClass: 'trading_card',
    description,
    lifecycleState: 'stored',
    holdFlag: false,
    receivedAt: recent,
  });
  const ALL = [card('a', 'Common Alpha'), card('b', 'Common Beta'), card('c', 'Common Gamma')];

  it('does not send a ticked card that a search has since hidden', async () => {
    post
      .mockResolvedValueOnce({ confirmationToken: 'tok-1' })
      .mockResolvedValueOnce({ count: 1 });
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { rerender } = renderIn(
      <RemoveCommonsPanel items={ALL} windowDays={30} onDone={onDone} onError={() => {}} />,
    );

    await user.click(screen.getByRole('checkbox', { name: /Common Alpha/ }));
    await user.click(screen.getByRole('checkbox', { name: /Common Beta/ }));

    rerender(
      <I18nProvider>
        <RemoveCommonsPanel items={[ALL[0]!]} windowDays={30} onDone={onDone} onError={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: /Remove 1 item\b/ }));
    await user.click(screen.getByRole('button', { name: /Remove them/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenNthCalledWith(1, '/services/remove-commons', { itemIds: ['a'], outcome: 'donate' });
  });

  it('names the cards in the confirmation, so nothing is removed unseen', async () => {
    const user = userEvent.setup();
    renderIn(<RemoveCommonsPanel items={ALL} windowDays={30} onDone={() => {}} onError={() => {}} />);
    await user.click(screen.getByRole('checkbox', { name: /Common Gamma/ }));
    await user.click(screen.getByRole('button', { name: /Remove 1 item\b/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/SN-C/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/SN-A/)).not.toBeInTheDocument();
  });
});

describe('the wallet running balance (F055)', () => {
  const LEDGER = Array.from({ length: 10 }, (_, i) => {
    const credit = i % 2 === 1;
    return {
      id: `l${i}`,
      type: credit ? 'credit_topup' : 'service_charge',
      amount: credit ? 2_000 : 500,
      direction: credit ? 'credit' : 'debit',
      currency: 'USD',
      referenceType: null,
      referenceId: null,
      occurredAt: new Date(Date.UTC(2026, 9, 10 - i, 12)).toISOString(),
    };
  });

  function walletApi(path: string) {
    if (path === '/finance/wallet') return Promise.resolve({ amount: 7_500, currency: 'USD' });
    if (path === '/finance/ledger') return Promise.resolve(LEDGER);
    if (path === '/finance/wallet/pending') return Promise.resolve({ cashInMinor: 0, cashOutMinor: 0, count: 0 });
    return Promise.resolve([]);
  }

  function balances(): string[] {
    const table = screen.getByRole('table');
    return within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => {
        const cells = within(row).getAllByRole('cell');
        return cells[cells.length - 1]!.textContent ?? '';
      });
  }

  it('shows the wallet balance against the newest movement, though only six are listed', async () => {
    get.mockImplementation(walletApi);
    renderIn(<WalletPage />);
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row').length).toBe(7));
    expect(balances()[0]).toContain('$75.00');
    expect(balances()).toEqual(['$75.00', '$80.00', '$60.00', '$65.00', '$45.00', '$50.00']);
  });

  it('does not change a movement’s balance when the list is filtered', async () => {
    window.location.hash = '#/wallet/transactions';
    get.mockImplementation(walletApi);
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row').length).toBe(11));
    const before = balances()[0];
    expect(before).toContain('$75.00');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filters' }), 'service_charge');
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row').length).toBe(6));
    expect(balances()[0]).toBe(before);
  });
});

describe('the wallet drawers say what a movement is, without record ids', () => {
  const ROW_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const REFERENCE = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const ROW = {
    id: ROW_ID,
    type: 'withdrawal',
    amount: 2_000,
    direction: 'debit',
    currency: 'USD',
    referenceType: 'wallet_request',
    referenceId: REFERENCE,
    occurredAt: '2026-10-10T12:00:00.000Z',
  };
  const REQUEST = {
    id: 'wr1',
    code: 'WR-AAAA1111',
    type: 'cash_out',
    status: 'completed',
    amount: 2_000,
    currency: 'USD',
    fundingSource: null,
    destinationAccount: 'IBAN-0001',
    beneficiaryName: 'Red Ashwood',
    reference: null,
    notes: null,
    rejectionReason: null,
    completedAt: '2026-10-10T12:00:00.000Z',
    createdAt: '2026-10-09T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
  };
  const DETAIL = {
    ...REQUEST,
    history: [
      { fromStatus: 'approved', toStatus: 'completed', occurredAt: '2026-10-10T12:00:00.000Z', byStaff: true, reason: null },
      { fromStatus: null, toStatus: 'submitted', occurredAt: '2026-10-09T12:00:00.000Z', byStaff: false, reason: null },
    ],
  };

  function walletApi(path: string) {
    if (path === '/finance/wallet') return Promise.resolve({ amount: 0, currency: 'USD' });
    if (path === '/finance/ledger') return Promise.resolve([ROW]);
    if (path === '/finance/wallet/pending') return Promise.resolve({ cashInMinor: 0, cashOutMinor: 0, count: 0 });
    if (path === '/finance/wallet-requests') return Promise.resolve([REQUEST]);
    if (path === '/finance/wallet-requests/wr1') return Promise.resolve(DETAIL);
    return Promise.resolve([]);
  }

  it('names a movement’s reference by its kind and shows no record id or reference uuid', async () => {
    window.location.hash = `#/wallet/transactions?transaction=${ROW_ID}`;
    get.mockImplementation(walletApi);
    renderIn(<WalletPage />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent('Record ID');
    expect(document.body.textContent).not.toContain(ROW_ID);
    expect(document.body.textContent).not.toContain(REFERENCE);
    expect(document.body.textContent).not.toContain(REFERENCE.slice(0, 8));
    expect(dialog).toHaveTextContent(t('wallet.ref.wallet_request', 'en'));
  });

  it('shows a settled request without its ledger record', async () => {
    window.location.hash = '#/wallet/requests?request=wr1';
    get.mockImplementation(walletApi);
    renderIn(<WalletPage />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('IBAN-0001'));
    expect(dialog).not.toHaveTextContent('Ledger record');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('a hand-delivery quote reaches the collector (F060)', () => {
  const QUOTED = {
    id: 'hd1',
    code: 'SHP-HAND0001',
    status: 'requested',
    fulfilmentMethod: 'hand_delivery',
    quoteMinor: 118_000,
    quoteNotes: '$1,000 base plus $180 travel.',
  };

  it('shows the quoted figure with a way to accept it', async () => {
    get.mockResolvedValue([QUOTED, { ...QUOTED, id: 'c1', code: 'SHP-CARRIER1', fulfilmentMethod: 'carrier', quoteMinor: null }]);
    post.mockResolvedValue({ status: 'rates_selected', cost: 118_000 });
    const user = userEvent.setup();
    const onStatus = vi.fn();
    renderIn(<WhiteGloveQuotes reloadToken={0} onError={() => {}} onStatus={onStatus} onChanged={() => {}} />);

    expect(await screen.findByText('$1,180.00')).toBeInTheDocument();
    expect(screen.queryByText('SHP-CARRIER1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/shipping/white-glove/hd1/accept', { quoteMinor: 118_000 }));
  });

  it('shows the new figure when the quote changed while the collector was reading', async () => {
    const { ApiError } = await import('../../apps/web/src/shared/api');
    get.mockResolvedValue([QUOTED]);
    post.mockRejectedValue(
      Object.assign(new ApiError('The quote changed to $1,500.00.'), { status: 409, code: 'quote_changed' }),
    );
    const user = userEvent.setup();
    const onError = vi.fn();
    const onChanged = vi.fn();
    renderIn(<WhiteGloveQuotes reloadToken={0} onError={onError} onStatus={() => {}} onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(String(onError.mock.calls.at(-1)?.[0] ?? '')).toMatch(/the quote changed/i);
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('asking for hand delivery and a show pickup', () => {
  const ITEMS = [
    { id: 'i1', serialNumber: 'SN-CL10-0005', typeClass: 'trading_card', description: 'Call of Legends Rayquaza' },
    { id: 'i2', serialNumber: 'SN-DR97-0001', typeClass: 'trading_card', description: 'EX Dragon Rayquaza' },
  ];
  const HOME = { id: 'a1', label: 'Home', recipient: 'Red Ashwood', line1: '12 Vine St', city: 'Trenton', region: 'NJ', country: 'US', postalCode: '08608', isDefault: true };
  const VAULT = { code: 'NJ1', name: 'Card Embassy Vault', role: 'primary', careOf: 'Card Embassy C/O red', lines: ['1 Vault Way'], city: 'Newark', region: 'NJ', postalCode: '07102', country: 'US', salesTaxBps: 0, forwardingDays: null };

  function answer() {
    get.mockImplementation((path: string) => {
      if (path === '/shipping/white-glove/terms') return Promise.resolve({ baseDomesticMinor: 15000, baseInternationalMinor: 60000, quoteWithinHours: 48 });
      if (path === '/me/addresses') return Promise.resolve([HOME]);
      if (path === '/me/inbound-addresses') return Promise.resolve([VAULT]);
      if (path === '/shipping/shipments') return Promise.resolve([{ id: 's1', code: 'SHP-OPEN0001', status: 'requested', itemIds: ['i2'] }]);
      if (path === '/shipping/pickup/shows') return Promise.resolve([]);
      return Promise.resolve([]);
    });
  }

  it('collects from the vault, delivers to a saved address, and asks for a date with a from and to time', async () => {
    answer();
    post.mockResolvedValue({ id: 'w1', code: 'SHP-HAND0001' });
    renderIn(<WhiteGlovePanel items={ITEMS} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />);
    const user = userEvent.setup();

    expect(await screen.findByText('On SHP-OPEN0001')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /SN-DR97-0001/ })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /SN-CL10-0005/ }));

    await waitFor(() => expect(screen.getByLabelText('Collect from')).toHaveValue('vault:NJ1'));
    expect(screen.getByLabelText('Deliver to')).toHaveValue('a1');
    expect(document.querySelectorAll('input[type="datetime-local"]')).toHaveLength(0);

    const pickup = screen.getByRole('group', { name: 'When it can be collected' });
    const delivery = screen.getByRole('group', { name: 'When it can be delivered' });
    await user.click(screen.getByRole('button', { name: 'Ask for a quote' }));
    expect(within(pickup).getByText('Choose a date and a time from and to.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(within(pickup).getByLabelText('Date'), { target: { value: '2030-03-04' } });
    fireEvent.change(within(delivery).getByLabelText('Date'), { target: { value: '2030-03-05' } });
    fireEvent.change(within(delivery).getByLabelText('and'), { target: { value: '12:00' } });
    await user.click(screen.getByRole('button', { name: 'Ask for a quote' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/shipping/white-glove');
    expect(body).toMatchObject({
      itemIds: ['i1'],
      pickupAddress: 'Card Embassy Vault, 1 Vault Way, Newark, NJ 07102, US',
      deliveryAddress: 'Red Ashwood, 12 Vine St, Trenton, NJ 08608, US',
      destinationCountry: 'US',
      recipientName: 'Red Ashwood',
      pickupFrom: new Date('2030-03-04T09:00').toISOString(),
      pickupTo: new Date('2030-03-04T17:00').toISOString(),
      deliverFrom: new Date('2030-03-05T09:00').toISOString(),
      deliverTo: new Date('2030-03-05T12:00').toISOString(),
    });
  });

  async function fillWindows(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('checkbox', { name: /SN-CL10-0005/ }));
    const pickup = screen.getByRole('group', { name: 'When it can be collected' });
    const delivery = screen.getByRole('group', { name: 'When it can be delivered' });
    fireEvent.change(within(pickup).getByLabelText('Date'), { target: { value: '2030-03-04' } });
    fireEvent.change(within(delivery).getByLabelText('Date'), { target: { value: '2030-03-05' } });
  }

  it('sends the phone of the saved address it delivers to, for the courier', async () => {
    answer();
    get.mockImplementation((path: string) => {
      if (path === '/me/addresses') return Promise.resolve([{ ...HOME, line2: 'Apt 4B', phone: '+1 609-555-0134' }]);
      if (path === '/me/inbound-addresses') return Promise.resolve([VAULT]);
      return Promise.resolve([]);
    });
    post.mockResolvedValue({ id: 'w1', code: 'SHP-HAND0001' });
    renderIn(<WhiteGlovePanel items={ITEMS} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />);
    const user = userEvent.setup();
    await fillWindows(user);
    await waitFor(() => expect(screen.getByLabelText('Deliver to')).toHaveValue('a1'));
    expect(screen.queryByLabelText('Phone for the courier (optional)')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ask for a quote' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({
      deliveryAddress: 'Red Ashwood, 12 Vine St, Apt 4B, Trenton, NJ 08608, US',
      contactPhone: '+1 609-555-0134',
    });
    expect(post.mock.calls[0]![1].deliveryAddress).not.toContain('555-0134');
  });

  it('sends no phone for a saved address that has none', async () => {
    answer();
    post.mockResolvedValue({ id: 'w1', code: 'SHP-HAND0001' });
    renderIn(<WhiteGlovePanel items={ITEMS} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />);
    const user = userEvent.setup();
    await fillWindows(user);
    await waitFor(() => expect(screen.getByLabelText('Deliver to')).toHaveValue('a1'));
    await user.click(screen.getByRole('button', { name: 'Ask for a quote' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).not.toHaveProperty('contactPhone');
  });

  it('asks for a phone for the courier after an address typed by hand, and sends it', async () => {
    answer();
    post.mockResolvedValue({ id: 'w1', code: 'SHP-HAND0001' });
    renderIn(<WhiteGlovePanel items={ITEMS} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />);
    const user = userEvent.setup();
    await fillWindows(user);
    await waitFor(() => expect(screen.getByLabelText('Deliver to')).toHaveValue('a1'));
    await user.selectOptions(screen.getByLabelText('Deliver to'), 'other');

    const typed = screen.getByLabelText('Deliver to this address');
    const phone = screen.getByLabelText('Phone for the courier (optional)');
    expect(typed.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('autocomplete', 'tel');
    expect(phone).toHaveAttribute('maxlength', '20');

    await user.type(typed, 'The Langham, 250 Franklin St, Boston MA 02110');
    await user.type(phone, ' +1 617-555-0199 ');
    await user.click(screen.getByRole('button', { name: 'Ask for a quote' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({
      deliveryAddress: 'The Langham, 250 Franklin St, Boston MA 02110',
      contactPhone: '+1 617-555-0199',
    });
  });

  it('dims an item already on a shipment in the show pickup too', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/shipping/pickup/shows') return Promise.resolve([{ id: 'e1', name: 'Card Show', startsAt: '2030-01-01', requestDeadline: '2029-12-20', open: true, venue: 'Hall', city: 'Newark', feeMinor: 1000, remaining: null }]);
      if (path === '/shipping/shipments') return Promise.resolve([{ id: 's1', code: 'SHP-OPEN0001', status: 'picking', itemIds: ['i1'] }]);
      return Promise.resolve([]);
    });
    renderIn(<ShowPickupPanel items={ITEMS} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />);
    expect(await screen.findByText('On SHP-OPEN0001')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /SN-CL10-0005/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /SN-DR97-0001/ })).toBeEnabled();
  });
});

describe('a label the carrier refused can be re-chosen (fix 4)', () => {
  const RATE = (serviceKey: string, carrier: string, serviceLevel: string, totalMinor: number) => ({
    serviceKey,
    carrier,
    serviceLevel,
    totalMinor,
    eligible: true,
    costMinor: totalMinor,
    handlingMinor: 0,
    insurancePremiumMinor: 0,
    addOnsMinor: 0,
    problems: [],
  });

  it('shows what each service does to what was paid, and chooses one', async () => {
    get.mockResolvedValue([
      RATE('usps_ground', 'USPS', 'Ground Advantage', 645),
      RATE('usps_priority', 'USPS', 'Priority Mail', 1_293),
      RATE('fedex_2day', 'FedEx', '2Day', 2_254),
    ]);
    const onChosen = vi.fn(async (fn: () => Promise<unknown>) => {
      await fn();
    });
    const user = userEvent.setup();
    function Rechoose() {
      const { t } = useI18n();
      return (
        <RechooseService
          shipment={{ id: 's1', cost: 1_293, labelRefused: { reason: 'The carrier could not print a label for this shipment.' } } as never}
          t={t}
          busy={false}
          onChosen={onChosen}
        />
      );
    }
    renderIn(<Rechoose />);

    expect(await screen.findByText('$6.48 back')).toBeInTheDocument();
    expect(screen.getByText('No change in price')).toBeInTheDocument();
    expect(screen.getByText('$9.61 more')).toBeInTheDocument();
    expect(screen.getByText('The carrier could not print a label for this shipment.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('The carrier said');
    await user.click(screen.getAllByRole('button')[0]!);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/shipping/shipments/s1/select-rate', { carrier: 'USPS', serviceLevel: 'Ground Advantage' }),
    );
  });
});

describe('cancelling a shipment says what it will cost', () => {
  const PICKUP = {
    id: 'pk1',
    code: 'SHP-PICKUP01',
    status: 'rates_selected',
    fulfilmentMethod: 'show_pickup',
    itemIds: ['i1'],
    destinationCountry: 'US',
    declaredValueMinor: 0,
    addOns: [],
    labelRefused: null,
  };

  it('asks the server for the fee and says when there is none', async () => {
    get.mockImplementation((path: string) =>
      path === '/shipping/shipments/pk1/cancel-fee' ? Promise.resolve({ restockingFeeMinor: 0 }) : Promise.resolve([]),
    );
    const user = userEvent.setup();
    renderIn(
      <ShipmentDrawer
        shipment={PICKUP as never}
        locale="en"
        t={(k: string) => k}
        onClose={() => {}}
        onChanged={() => {}}
        onStatus={() => {}}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'ship.cancel' }));
    expect(await screen.findByText('ship.cancelNoFee')).toBeInTheDocument();
    expect(screen.queryByText('ship.cancelFeeWarning')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/shipping/shipments/pk1/cancel-fee');
  });
});

describe('a collector’s own hand delivery', () => {
  it('shows the phone they gave for the courier under the destination', () => {
    get.mockResolvedValue([]);
    renderIn(
      <ShipmentDrawer
        shipment={{
          id: 'hd1',
          code: 'SHP-HAND0001',
          status: 'requested',
          fulfilmentMethod: 'hand_delivery',
          itemIds: ['i1'],
          destinationAddress: 'The Langham, 250 Franklin St, Boston MA 02110',
          contactPhone: '+1 617-555-0199',
          destinationCountry: 'US',
          declaredValueMinor: 0,
          insuredValueMinor: 0,
          addOns: [],
          labelRefused: null,
          createdAt: '2030-01-01T00:00:00Z',
        } as never}
        locale="en"
        t={(k: string) => k}
        onClose={() => {}}
        onChanged={() => {}}
        onStatus={() => {}}
      />,
    );
    expect(screen.getByText('ff.wg.courierPhone')).toBeInTheDocument();
    expect(screen.getByText('+1 617-555-0199')).toBeInTheDocument();
  });
});
