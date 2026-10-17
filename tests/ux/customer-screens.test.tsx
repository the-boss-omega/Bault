import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The screens a collector actually looks at.
 *
 * Three things are worth asserting about a page that reads from an API, and none
 * of them are visible to a type checker: that it shows something sensible while
 * loading, that it shows the REASON when the call fails rather than an empty
 * frame, and that an empty result reads as "nothing here yet" rather than as a
 * broken page.
 */

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
const { AccountPill } = await import('../../apps/web/src/shared/ui/PageHeader');
const { IntakePolicyPanel } = await import('../../apps/web/src/areas/customer/help/IntakePolicyPanel');
const { VaultPage } = await import('../../apps/web/src/areas/customer/vault/VaultPage');
const { RemoveCommonsPanel } = await import('../../apps/web/src/areas/customer/vault/RemoveCommonsPanel');
const { WalletPage } = await import('../../apps/web/src/areas/customer/finance/WalletPage');
const { WhiteGloveQuotes } = await import('../../apps/web/src/areas/customer/shipping/HumanFulfilmentPanels');

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
    // The login response does not carry a username; it arrives with the profile
    // request. Rendering a bare "@" for that frame would flash a broken
    // identifier on every single sign-in.
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

    // Telling somebody their box of commons was "prohibited" would be a false
    // statement about their property, made by the platform that destroyed it.
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
    expect(screen.getByText(/loading|טוען/i)).toBeInTheDocument();
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
    isLot: false,
    lotSize: 1,
    oversized: false,
  };

  it('lists what the collector owns, with the catalogue detail that identifies it', async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/vault/items') ? [ITEM] : { stored: 1 }),
    );
    renderIn(<VaultPage />);
    // The description appears in the card and again in its detail affordance;
    // what matters is that the catalogue line reached the screen at all.
    await waitFor(() => expect(screen.getAllByText(/Rayquaza ex/).length).toBeGreaterThan(0));
  });

  it('says the vault is empty rather than rendering a blank frame', async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/vault/items') ? [] : {}),
    );
    renderIn(<VaultPage />);
    /**
     * An empty state is a sentence, not the absence of one — the difference
     * between "nothing in your vault yet" and a page that looks broken. It does
     * not say "cards", because a vault holds comics and sealed boxes too. The
     * matcher is deliberately loose about the exact phrasing and strict about
     * there being one.
     */
    await waitFor(() => {
      const empty = screen.queryByText(/nothing (in your vault|to show)|no (active )?(cards|items)/i);
      expect(empty, 'the vault renders no empty state at all').toBeTruthy();
    });
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
                departureReason: 'remove commons — discarded',
              },
            ]
          : { active: 0, hold: 0, history: 1 },
      ),
    );
    renderIn(<VaultPage />);
    await waitFor(() => expect(screen.getAllByText(/Bulk common, culled/).length).toBeGreaterThan(0));
    expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/vault\/items\?scope=history/));
    // The history tile reads "Historical — Discarded".
    expect(screen.getAllByText(/Discarded/).length).toBeGreaterThan(0);
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

    // The vault's search narrows the list the panel is given. Beta is ticked
    // and no longer on screen.
    rerender(
      <I18nProvider>
        <RemoveCommonsPanel items={[ALL[0]!]} windowDays={30} onDone={onDone} onError={() => {}} />
      </I18nProvider>,
    );

    // The count on the button is the count that will be removed.
    await user.click(screen.getByRole('button', { name: /Remove 1 items/ }));
    await user.click(screen.getByRole('button', { name: /Remove them/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenNthCalledWith(1, '/services/remove-commons', { itemIds: ['a'], outcome: 'donate' });
  });

  it('names the cards in the confirmation, so nothing is removed unseen', async () => {
    const user = userEvent.setup();
    renderIn(<RemoveCommonsPanel items={ALL} windowDays={30} onDone={() => {}} onError={() => {}} />);
    await user.click(screen.getByRole('checkbox', { name: /Common Gamma/ }));
    await user.click(screen.getByRole('button', { name: /Remove 1 items/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/SN-C/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/SN-A/)).not.toBeInTheDocument();
  });
});

describe('the wallet running balance (F055)', () => {
  /**
   * Ten movements, newest first, as `GET /finance/ledger` returns them: five
   * $20 cash-ins and five $5 service charges, alternating. The wallet stands
   * at $75.00.
   */
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

  /** The Balance cell of each body row, top to bottom. */
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
    // …and every row below it is the wallet's position after that movement:
    // $75 − (−$5) − $20 + $5 − $20 + $5 for the sixth row down.
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
    // The newest movement is a service charge: after it the wallet held $75.00,
    // whatever else is hidden. Recomputed over the filtered rows it would read
    // -$25.00.
    expect(balances()[0]).toBe(before);
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
    await waitFor(() => expect(post).toHaveBeenCalledWith('/shipping/white-glove/hd1/accept'));
  });
});
