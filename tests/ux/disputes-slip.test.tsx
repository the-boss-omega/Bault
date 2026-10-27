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
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const TRANSACTIONS = [
  {
    id: 'c5013f0a-0000-4000-8000-000000000001',
    type: 'sale',
    price: 26000,
    buyerId: 'b',
    sellerId: 's',
    createdAt: '2026-10-27T12:00:00.000Z',
  },
  {
    id: 'd7e21b90-0000-4000-8000-000000000002',
    type: 'swap',
    price: 0,
    buyerId: 'b',
    sellerId: 's',
    createdAt: '2026-10-20T12:00:00.000Z',
  },
];

const DISPUTES = [
  {
    id: '41ea05e9-0000-4000-8000-0000000000aa',
    transactionId: TRANSACTIONS[0]!.id,
    status: 'investigating',
    ruling: null,
    note: 'Buyer reports a nicked corner.',
    createdAt: '2026-10-27T13:00:00.000Z',
  },
  {
    id: '9b0c77d1-0000-4000-8000-0000000000bb',
    transactionId: TRANSACTIONS[1]!.id,
    status: 'ruled',
    ruling: 'Refund the buyer in full',
    note: null,
    createdAt: '2026-10-21T13:00:00.000Z',
  },
  {
    id: '2f66a3c4-0000-4000-8000-0000000000cc',
    transactionId: 'gone-0000-4000-8000-000000000003',
    status: 'open',
    ruling: null,
    note: null,
    createdAt: '2026-10-22T13:00:00.000Z',
  },
];

function api(disputes: unknown[] = DISPUTES, transactions: unknown[] = TRANSACTIONS) {
  get.mockImplementation(async (path: string) => {
    if (path === '/admin/disputes') return disputes;
    if (path === '/admin/transactions') return transactions;
    return [];
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
});

async function disputes() {
  window.location.hash = '#/admin/disputes';
  const view = render(
    <I18nProvider>
      <AdminConsole currentUserId="me" />
    </I18nProvider>,
  );
  await screen.findByRole('heading', { name: /^Disputes \(/ });
  return view;
}

describe('a dispute, written on a slip as it is opened', () => {
  const slip = () => document.querySelector('.request-slip .drawer-tag') as HTMLElement;

  it('asks for the transaction before it says anything else, and begins as open', async () => {
    api();
    await disputes();
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Transaction' }).querySelectorAll('option').length,
      ).toBeGreaterThan(1),
    );
    expect(slip()).toHaveAccessibleName('Transaction');
    expect(slip().querySelector('.drawer-tag-title .drawer-tag-quiet')).toHaveTextContent(
      '— Select a transaction —',
    );
    expect(slip().querySelector('.drawer-tag-amount')).toBeNull();
    expect(within(slip()).getByText('Open')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open dispute' })).toBeDisabled();
  });

  it('shows the transaction chosen, its sum, what kind it was, when, and the note as it is typed', async () => {
    api();
    const user = userEvent.setup();
    await disputes();
    const picker = screen.getByRole('combobox', { name: 'Transaction' });
    await waitFor(() => expect(picker.querySelectorAll('option').length).toBeGreaterThan(1));
    await user.selectOptions(picker, TRANSACTIONS[0]!.id);
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'Not as described');

    expect(slip().querySelector('.drawer-tag-title')).toHaveTextContent('c5013f0a');
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('$260.00');
    expect(within(slip()).getByText('Type').nextElementSibling).toHaveTextContent('sale');
    expect(slip().querySelector('.ticket-note p')).toHaveTextContent('Not as described');
    expect(screen.getByRole('button', { name: 'Open dispute' })).toBeEnabled();
  });

  it('opens what the slip shows', async () => {
    api();
    post.mockResolvedValue({});
    const user = userEvent.setup();
    await disputes();
    const picker = screen.getByRole('combobox', { name: 'Transaction' });
    await waitFor(() => expect(picker.querySelectorAll('option').length).toBeGreaterThan(1));
    await user.selectOptions(picker, TRANSACTIONS[1]!.id);
    await user.click(screen.getByRole('button', { name: 'Open dispute' }));
    expect(post).toHaveBeenCalledWith('/admin/disputes', {
      transactionId: TRANSACTIONS[1]!.id,
      note: undefined,
    });
  });

  it('says there is nothing to dispute, and has no slip, where no transaction has been recorded', async () => {
    api(DISPUTES, []);
    await disputes();
    expect(await screen.findByText('No recorded transactions to dispute.')).toBeInTheDocument();
    expect(document.querySelector('.request-slip')).toBeNull();
  });
});

describe('the disputes, a case file each', () => {
  const files = () =>
    Array.from(document.querySelectorAll('.tag-grid .drawer-tag')) as HTMLElement[];

  it('are the newest first, each with its number, its ruling (or that there is none) and where it stands', async () => {
    api();
    await disputes();
    expect(files().map((f) => f.getAttribute('aria-label'))).toEqual([
      '41ea05e9',
      '2f66a3c4',
      '9b0c77d1',
    ]);

    const [newest, , ruled] = files() as [HTMLElement, HTMLElement, HTMLElement];
    expect(newest.querySelector('.drawer-tag-title .drawer-tag-quiet')).toHaveTextContent('Ruling');
    expect(within(newest).getByText('Investigating')).toBeInTheDocument();
    expect(ruled.querySelector('.drawer-tag-title')).toHaveTextContent('Refund the buyer in full');
    expect(ruled.querySelector('.drawer-tag-title .drawer-tag-quiet')).toBeNull();
    expect(within(ruled).getByText('Ruled')).toBeInTheDocument();
  });

  it('carry the transaction they are about, with its kind and sum where it is known, and the note that was made', async () => {
    api();
    await disputes();
    const [newest, orphan] = files() as [HTMLElement, HTMLElement];
    expect(within(newest).getByText('Transaction').nextElementSibling).toHaveTextContent(
      'c5013f0a',
    );
    expect(within(newest).getByText('Type').nextElementSibling).toHaveTextContent('sale');
    expect(within(newest).getByText('Price').nextElementSibling).toHaveTextContent('$260.00');
    expect(newest.querySelector('blockquote')).toHaveTextContent('Buyer reports a nicked corner.');
    // A transaction that is not in the list is only named; nothing is made up about it.
    expect(within(orphan).getByText('Transaction').nextElementSibling).toHaveTextContent(
      'gone-000',
    );
    expect(within(orphan).queryByText('Price')).toBeNull();
    expect(orphan.querySelector('blockquote')).toBeNull();
  });

  it('are moved on from under the file, with a ruling, and say what they send', async () => {
    api();
    patch.mockResolvedValue({});
    const user = userEvent.setup();
    await disputes();
    const item = files()[0]!.closest('li') as HTMLElement;
    await user.type(within(item).getByRole('textbox', { name: 'Ruling' }), 'Seller to refund');
    await user.selectOptions(within(item).getByRole('combobox', { name: 'Status' }), 'ruled');
    await user.click(within(item).getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/admin/disputes/41ea05e9-0000-4000-8000-0000000000aa', {
      status: 'ruled',
      ruling: 'Seller to refund',
    });
  });

  it('keep their controls off the paper', async () => {
    api();
    await disputes();
    for (const file of files()) {
      expect(within(file).queryByRole('combobox')).toBeNull();
      expect(within(file).queryByRole('button')).toBeNull();
    }
  });

  it('say there are none when there are none', async () => {
    api([]);
    await disputes();
    expect(await screen.findByText('No disputes.')).toBeInTheDocument();
    expect(files()).toHaveLength(0);
  });
});
