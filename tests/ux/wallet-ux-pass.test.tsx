import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { WalletPage } = await import('../../apps/web/src/areas/customer/finance/WalletPage');
const { TopUpPanel } = await import('../../apps/web/src/areas/customer/finance/MoneyPanels');
const { WalletRequestForm } =
  await import('../../apps/web/src/areas/customer/finance/WalletRequestForms');
const { chargeNamesFrom } = await import('../../apps/web/src/areas/customer/finance/chargeNames');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const REQUEST_ID = '5b0c6f1e-6a3a-4a5e-9d0b-0c4c7a1e2f30';

const LEDGER = [
  {
    id: 'l1',
    type: 'service_charge',
    amount: 100,
    direction: 'debit',
    currency: 'USD',
    referenceType: 'charge',
    referenceId: 'c1',
    chargeAction: 'intake',
    chargeItemClass: 'single_card',
    occurredAt: '2026-11-20T12:00:00.000Z',
  },
  {
    id: 'l2',
    type: 'credit_topup',
    amount: 500_000,
    direction: 'credit',
    currency: 'USD',
    referenceType: 'wallet_request',
    referenceId: REQUEST_ID,
    chargeAction: null,
    chargeItemClass: null,
    occurredAt: '2026-11-19T12:00:00.000Z',
  },
  {
    id: 'l3',
    type: 'purchase',
    amount: 26_000,
    direction: 'debit',
    currency: 'USD',
    referenceType: 'listing',
    referenceId: 'x',
    chargeAction: null,
    chargeItemClass: null,
    occurredAt: '2026-11-21T12:00:00.000Z',
  },
];

const PRICE_LIST = {
  groups: [
    {
      group: 'intake',
      entries: [
        { actionType: 'intake', itemClass: 'single_card', description: 'Intake: A single card' },
        {
          actionType: 'intake',
          itemClass: null,
          description: 'Intake handling fee per received item',
        },
      ],
    },
  ],
};

const request = (over: Record<string, unknown>) => ({
  id: 'wr-x',
  code: 'WR-XXXXXXXX',
  type: 'cash_in',
  status: 'submitted',
  amount: 25_000,
  currency: 'USD',
  fundingSource: 'bank_transfer',
  destinationAccount: null,
  beneficiaryName: null,
  reference: null,
  notes: null,
  rejectionReason: null,
  createdAt: '2026-11-20T12:00:00.000Z',
  updatedAt: '2026-11-20T12:00:00.000Z',
  ...over,
});

const REQUESTS = [
  request({
    id: REQUEST_ID,
    code: 'WR-AAAA1111',
    status: 'completed',
    amount: 500_000,
    createdAt: '2026-11-19T12:00:00.000Z',
  }),
  request({
    id: 'wr2',
    code: 'WR-BBBB2222',
    type: 'cash_out',
    status: 'rejected',
    amount: 300_000,
    createdAt: '2026-11-21T12:00:00.000Z',
    fundingSource: null,
  }),
  request({
    id: 'wr3',
    code: 'WR-CCCC3333',
    status: 'submitted',
    amount: 25_000,
    createdAt: '2026-11-22T12:00:00.000Z',
  }),
];

const CATALOGUE = {
  limits: { minMinor: 1_000, maxMinor: 2_000_000 },
  routes: [
    {
      key: 'card',
      label: 'Card',
      instant: true,
      feeBps: 0,
      description: '',
      available: true,
      checkout: 'direct',
      instructions: null,
    },
  ],
  referenceNote: '',
};

function walletApi(balance = 473_900) {
  return (path: string) => {
    if (path === '/finance/wallet') return Promise.resolve({ amount: balance, currency: 'USD' });
    if (path === '/finance/ledger') return Promise.resolve(LEDGER);
    if (path === '/finance/wallet/pending')
      return Promise.resolve({ cashInMinor: 25_000, cashOutMinor: 0, count: 1 });
    if (path === '/finance/wallet-requests') return Promise.resolve(REQUESTS);
    if (path === `/finance/wallet-requests/${REQUEST_ID}`)
      return Promise.resolve({ ...REQUESTS[0], history: [] });
    if (path === '/finance/wallet-requests/wr3')
      return Promise.resolve({ ...REQUESTS[2], history: [] });
    if (path === '/pricing/list') return Promise.resolve(PRICE_LIST);
    if (path === '/finance/funding-routes') return Promise.resolve(CATALOGUE);
    return Promise.resolve(null);
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  window.location.hash = '';
});

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1);
}

describe('the wallet header', () => {
  it('offers Cash in as the one primary action and Cash out beside it on the overview', async () => {
    window.location.hash = '#/wallet';
    get.mockImplementation(walletApi());
    renderIn(<WalletPage />);
    const cashIn = await screen.findByRole('button', { name: 'Cash in' });
    expect(cashIn.className).toMatch(/primary/);
    expect(screen.getByRole('button', { name: 'Cash out' }).className).not.toMatch(/primary/);
  });

  it('leaves the form’s own button as the only primary action on the cash-out tab', async () => {
    window.location.hash = '#/wallet/cash-out';
    get.mockImplementation(walletApi());
    renderIn(<WalletPage />);
    await screen.findByRole('button', { name: 'Submit request' });
    expect(screen.queryByRole('button', { name: 'Cash in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cash out' })).toBeNull();
  });

  it('shows only the direction that has money waiting, not a $0.00 slip', async () => {
    window.location.hash = '#/wallet';
    get.mockImplementation(walletApi());
    renderIn(<WalletPage />);
    expect(await screen.findByText('Cash in pending')).toBeInTheDocument();
    expect(screen.queryByText('Cash out pending')).toBeNull();
  });
});

describe('the transactions list', () => {
  it('names a charge by what it was for, from the price list, by its item class', async () => {
    window.location.hash = '#/wallet/transactions';
    get.mockImplementation(walletApi());
    renderIn(<WalletPage />);
    await waitFor(() =>
      expect(screen.getAllByText('Intake: A single card').length).toBeGreaterThan(0),
    );
  });

  it('names an interest charge in words, not by the raw reference type', async () => {
    window.location.hash = '#/wallet/transactions';
    const interest = {
      id: 'l9',
      type: 'interest',
      amount: 37,
      direction: 'debit',
      currency: 'USD',
      referenceType: 'interest',
      referenceId: 'i9',
      chargeAction: null,
      chargeItemClass: null,
      occurredAt: '2026-11-22T12:00:00.000Z',
    };
    const base = walletApi();
    get.mockImplementation((path: string) => (path === '/finance/ledger' ? Promise.resolve([...LEDGER, interest]) : base(path)));
    renderIn(<WalletPage />);
    await waitFor(() => expect(screen.getAllByText('Interest on a negative balance').length).toBeGreaterThan(0));
    expect(screen.queryByText('interest')).toBeNull();
  });

  it('is searched by what a movement was for and by its amount', async () => {
    window.location.hash = '#/wallet/transactions';
    get.mockImplementation(walletApi());
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    await user.type(screen.getByRole('searchbox', { name: /search by type/i }), 'single card');
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    await user.clear(screen.getByRole('searchbox', { name: /search by type/i }));
    await user.type(screen.getByRole('searchbox', { name: /search by type/i }), '260.00');
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(bodyRows()[0]).toHaveAccessibleName(/Purchase/);
  });

  it('says nothing matches and clears the search with the filters', async () => {
    window.location.hash = '#/wallet/transactions';
    get.mockImplementation(walletApi());
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    await user.type(
      screen.getByRole('searchbox', { name: /search by type/i }),
      'nothing like this',
    );
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    expect(screen.getByRole('searchbox', { name: /search by type/i })).toHaveValue('');
  });

  it('sorts by date either way and by amount either way', async () => {
    window.location.hash = '#/wallet/transactions';
    get.mockImplementation(walletApi());
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    const order = () => bodyRows().map((row) => row.getAttribute('aria-label')!.split(' · ')[0]);
    expect(order()).toEqual(['Purchase', 'Service charge', 'Cash in']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'oldest');
    expect(order()).toEqual(['Cash in', 'Service charge', 'Purchase']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'largest');
    expect(order()).toEqual(['Cash in', 'Purchase', 'Service charge']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'smallest');
    expect(order()).toEqual(['Service charge', 'Purchase', 'Cash in']);
  });

  it('keeps each movement’s balance after it, whatever the order', async () => {
    window.location.hash = '#/wallet/transactions';
    get.mockImplementation(walletApi());
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    const balanceOf = (name: RegExp) => {
      const row = bodyRows().find((r) => name.test(r.getAttribute('aria-label') ?? ''))!;
      const cells = within(row).getAllByRole('cell');
      return cells[cells.length - 1]!.textContent;
    };
    const before = balanceOf(/^Cash in/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'smallest');
    expect(balanceOf(/^Cash in/)).toBe(before);
    expect(before).toContain('$5,000.00');
  });
});

describe('a movement, opened', () => {
  it('says what a charge was for, with the balance after it and the way to the price list', async () => {
    window.location.hash = '#/wallet/transactions?transaction=l1';
    get.mockImplementation(walletApi());
    renderIn(<WalletPage />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('What it was for')).toBeInTheDocument());
    expect(within(dialog).getByText('Intake: A single card')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'See the price list' })).toHaveAttribute(
      'href',
      '#/faq/prices',
    );
    expect(within(dialog).getByText('Balance after').nextElementSibling).toHaveTextContent(
      '$4,999.00',
    );
  });

  it('opens the request a cash-in came from', async () => {
    window.location.hash = '#/wallet/transactions?transaction=l2';
    get.mockImplementation(walletApi());
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Open the request' }));
    await waitFor(() => expect(window.location.hash).toContain(`request=${REQUEST_ID}`));
    expect(window.location.hash).not.toContain('transaction=');
  });
});

describe('the requests list', () => {
  it('names each line for a screen reader and filters by status', async () => {
    window.location.hash = '#/wallet/requests';
    get.mockImplementation(walletApi());
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    expect(bodyRows()[0]).toHaveAccessibleName('WR-CCCC3333 · Cash in · $250.00 · Submitted');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'rejected');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveAccessibleName(/WR-BBBB2222/);
  });

  it('sorts by amount', async () => {
    window.location.hash = '#/wallet/requests';
    get.mockImplementation(walletApi());
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'largest');
    expect(bodyRows().map((r) => r.getAttribute('aria-label')!.split(' · ')[0])).toEqual([
      'WR-AAAA1111',
      'WR-BBBB2222',
      'WR-CCCC3333',
    ]);
  });

  it('says when nothing matches, and clears the search and the status together', async () => {
    window.location.hash = '#/wallet/requests';
    get.mockImplementation(walletApi());
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'paying');
    expect(screen.getByText('No requests match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
  });

  it('says what happened when a request is cancelled', async () => {
    window.location.hash = '#/wallet/requests?request=wr3';
    get.mockImplementation(walletApi());
    post.mockResolvedValue({});
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'Cancel request' }));
    const confirm = await screen.findByRole('dialog', { name: 'Cancel request' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel request' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/finance/wallet-requests/wr3/cancel', {}),
    );
    expect(await screen.findByText('The request was cancelled.')).toBeInTheDocument();
    expect(await screen.findByText(/Request WR-CCCC3333 was cancelled/)).toBeInTheDocument();
  });
});

describe('cash out', () => {
  it('says there is nothing to cash out, and the way to put money in, when the balance is empty', async () => {
    window.location.hash = '#/wallet/cash-out';
    get.mockImplementation(walletApi(0));
    renderIn(<WalletPage />);
    expect(await screen.findByText('Nothing to cash out yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cash in' })).toBeInTheDocument();
  });

  it('says when the fee could not be worked out, and works it out again', async () => {
    let fail = true;
    get.mockImplementation((path: string) => {
      if (path.startsWith('/finance/cash-out-quote')) {
        if (fail) return Promise.reject(new Error('offline'));
        return Promise.resolve({
          amountMinor: 5_000,
          feeMinor: 300,
          netMinor: 4_700,
          schedule: {
            bandMinor: 10_000,
            smallBps: 600,
            smallMinimumMinor: 99,
            largeFixedMinor: 500,
            largeBps: 100,
          },
        });
      }
      return Promise.resolve(null);
    });
    const user = userEvent.setup();
    renderIn(
      <WalletRequestForm
        type="cash_out"
        availableMinor={100_000}
        existingRequests={[]}
        onSubmitted={() => {}}
      />,
    );
    await user.type(screen.getByLabelText('Amount'), '50');
    expect(await screen.findByText(/fee could not be worked out/)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/\$3\.00 comes off \$50\.00/)).toBeInTheDocument();
  });
});

describe('a request for money', () => {
  it('gives its limits and its errors as money is written everywhere else', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(null);
    renderIn(
      <WalletRequestForm
        type="cash_in"
        availableMinor={0}
        existingRequests={[]}
        onSubmitted={() => {}}
      />,
    );
    expect(screen.getAllByText('Between $10.00 and $20,000.00.').length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText('Amount'), '25000');
    expect(screen.getByText('The maximum for a request is $20,000.00.')).toBeInTheDocument();
  });

  it('asks for no file key a collector has no way to get', () => {
    get.mockResolvedValue(null);
    renderIn(
      <WalletRequestForm
        type="cash_in"
        availableMinor={0}
        existingRequests={[]}
        onSubmitted={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Supporting document')).toBeNull();
  });

  it('takes the keyboard to the first field that needs fixing when it is sent incomplete', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(null);
    renderIn(
      <WalletRequestForm
        type="cash_out"
        availableMinor={100_000}
        existingRequests={[]}
        onSubmitted={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveFocus());
    expect(post).not.toHaveBeenCalled();
  });

  it('is said to have been sent, with its number and what comes next, on the list it joined', async () => {
    window.location.hash = '#/wallet/cash-out';
    get.mockImplementation(walletApi());
    post.mockResolvedValue({ code: 'WR-NEWNEW01' });
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await user.type(await screen.findByLabelText('Amount'), '50');
    await user.type(screen.getByLabelText(/Destination account/), 'GB29NWBK60161331926819');
    await user.type(screen.getByLabelText('Beneficiary name'), 'Red Ashwood');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(
      await screen.findByText(/Request WR-NEWNEW01 for \$50\.00 was sent for review/),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toContain('/wallet/requests'));
  });
});

describe('cash in', () => {
  it('keeps the form for a payment made another way closed until it is asked for, then puts the keyboard in it', async () => {
    window.location.hash = '#/wallet/cash-in';
    get.mockImplementation(walletApi());
    const user = userEvent.setup();
    renderIn(<WalletPage />);
    await screen.findByRole('button', { name: 'Pay now' });
    expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tell us about a payment' }));
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getAllByLabelText('Amount').at(-1));
  });

  it('says where the ways to pay could not be loaded, and loads them again', async () => {
    let fail = true;
    get.mockImplementation((path: string) =>
      path === '/finance/funding-routes' && fail
        ? Promise.reject(new Error('The server is not answering.'))
        : Promise.resolve(CATALOGUE),
    );
    const user = userEvent.setup();
    renderIn(<TopUpPanel onError={() => {}} onStatus={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText('The ways to pay could not be loaded')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Pay now' })).toBeInTheDocument();
  });

  it('says beside the amount why Pay now cannot be pressed', async () => {
    get.mockResolvedValue(CATALOGUE);
    const user = userEvent.setup();
    renderIn(<TopUpPanel onError={() => {}} onStatus={() => {}} onChanged={() => {}} />);
    await user.type(await screen.findByLabelText('Amount'), '5');
    expect(screen.getByLabelText('Amount')).toHaveAccessibleDescription(
      'Enter an amount between $10.00 and $20,000.00.',
    );
    expect(screen.getByRole('button', { name: 'Pay now' })).toBeDisabled();
  });
});

describe('the names of charges', () => {
  it('prefers the entry for the item class, falls back to the catch-all, and says nothing it cannot be sure of', () => {
    const names = chargeNamesFrom({
      groups: [
        {
          group: 'g',
          entries: [
            { actionType: 'intake', itemClass: 'single_card', description: 'card' },
            { actionType: 'intake', itemClass: null, description: 'catch-all' },
            { actionType: 'service_fee:a', itemClass: 'x', description: 'only one' },
            { actionType: 'two', itemClass: 'x', description: 'one' },
            { actionType: 'two', itemClass: 'y', description: 'other' },
          ],
        },
      ],
    });
    expect(names.get('intake', 'single_card')).toBe('card');
    expect(names.get('intake', 'memorabilia')).toBe('catch-all');
    expect(names.get('service_fee:a', null)).toBe('only one');
    expect(names.get('two', null)).toBeNull();
    expect(names.get('unknown', null)).toBeNull();
  });
});
