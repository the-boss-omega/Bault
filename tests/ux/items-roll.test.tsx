import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const patch = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
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

const user = (id: string, email: string) => ({
  id,
  email,
  username: email.split('@')[0],
  firstName: null,
  lastName: null,
  nameReviewRequired: false,
  role: 'user',
  status: 'active',
  autoSuspended: false,
  intakeId: null,
  mfaEnabled: false,
});
const USERS = [user('u1', 'red@bault.dev'), user('u2', 'golden@bault.dev')];

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  serialNumber: `SN-${id}-0001`,
  barcode: `SN-${id}-0001`,
  typeClass: 'trading_card',
  description:
    '2021 Pokémon SWSH Evolving Skies — Rayquaza VMAX #218/203 · Alt Art · art by Kouki Saitou',
  conditionGrade: 'Raw',
  lifecycleState: 'stored',
  holdFlag: false,
  binId: null,
  ownerId: 'u1',
  ownerEmail: 'red@bault.dev',
  ...extra,
});
const ITEMS = [
  item('A'),
  item('B', {
    lifecycleState: 'on-hold',
    holdFlag: true,
    ownerId: 'u2',
    ownerEmail: 'golden@bault.dev',
  }),
  item('C', { lifecycleState: 'at_grader' }),
];

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  get.mockImplementation(async (path: string) =>
    path === '/admin/users' ? USERS : path === '/admin/items' ? ITEMS : [],
  );
  window.location.hash = '#/admin/items';
});

function items() {
  return render(
    <I18nProvider>
      <AdminConsole currentUserId="u1" />
    </I18nProvider>,
  );
}

const rows = () => Array.from(document.querySelectorAll('.data-table tbody tr')) as HTMLElement[];

describe('the inventory, a roll', () => {
  it('has a line to each item: its name, its number, whose it is and where it stands', async () => {
    items();
    await waitFor(() => expect(rows()).toHaveLength(3));
    const [stored, held, grader] = rows() as [HTMLElement, HTMLElement, HTMLElement];
    // The name of a card, not the whole catalogue line.
    expect(within(stored).getByRole('button')).toHaveTextContent(
      '2021 Pokémon SWSH Evolving Skies — Rayquaza VMAX #218/203',
    );
    expect(stored).not.toHaveTextContent('Kouki Saitou');
    expect(stored).toHaveTextContent('SN-A-0001');
    expect(stored).toHaveTextContent('red@bault.dev');
    expect(within(stored).getByText('Stored')).toBeInTheDocument();
    expect(within(stored).queryByText('On hold')).toBeNull();

    expect(within(held).getAllByText('On hold').length).toBeGreaterThanOrEqual(1);
    expect(held).toHaveTextContent('golden@bault.dev');
    // A state the list of states does not carry is still said in the words of the state.
    expect(within(grader).getByText(/grader/i)).toBeInTheDocument();
  });

  it('says the number as a code and the condition beside it, so grades can be read down the roll', async () => {
    items();
    await waitFor(() => expect(rows()).toHaveLength(3));
    for (const row of rows()) {
      const sub = row.querySelector('.dt-sub') as HTMLElement;
      expect(sub.querySelector('.code-inline[dir="ltr"]')).not.toBeNull();
      expect(sub).toHaveTextContent(/SN-[ABC]-0001 · Raw/);
    }
  });

  it('keeps no field of an item in its line', async () => {
    items();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(
      document.querySelectorAll('.data-table input, .data-table select, .data-table textarea'),
    ).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('an item, opened', () => {
  it('is opened by its name and is a link that can be sent', async () => {
    const user = userEvent.setup();
    items();
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(within(rows()[1]!).getByRole('button'));
    expect(window.location.hash).toBe('#/admin/items?item=B');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows the item as a card that follows the name, the owner and the state as they are chosen, with its barcode', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/admin/items?item=A';
    items();
    const drawer = await screen.findByRole('dialog');
    const card = within(drawer).getByRole('region', { name: 'SN-A-0001' });
    expect(card.querySelector('.drawer-tag-title')).toHaveTextContent(
      '2021 Pokémon SWSH Evolving Skies — Rayquaza VMAX #218/203',
    );
    expect(card.querySelector('.barcode svg')).not.toBeNull();
    expect(within(card).getByText('Owner').nextElementSibling).toHaveTextContent('red@bault.dev');
    expect(within(card).getByText('Stored')).toBeInTheDocument();

    await user.selectOptions(within(drawer).getByRole('combobox', { name: 'Owner' }), 'u2');
    await user.selectOptions(
      within(drawer).getByRole('combobox', { name: 'Lifecycle' }),
      'on-hold',
    );
    await user.click(within(drawer).getByRole('checkbox', { name: 'On hold' }));

    expect(within(card).getByText('Owner').nextElementSibling).toHaveTextContent(
      'golden@bault.dev',
    );
    expect(within(card).queryByText('Stored')).toBeNull();
    expect(within(card).getAllByText('On hold').length).toBeGreaterThanOrEqual(2);
  });

  it('prints the barcode and shows the photograph from under the card, not from the paper', async () => {
    window.location.hash = '#/admin/items?item=A';
    items();
    const drawer = await screen.findByRole('dialog');
    const card = within(drawer).getByRole('region', { name: 'SN-A-0001' });
    expect(within(drawer).getByRole('button', { name: /print the barcode SN-A-0001/i })).toBeInTheDocument();
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('does not say the number three times: the subtitle is left out when it is the serial the card already carries', async () => {
    window.location.hash = '#/admin/items?item=A';
    items();
    const drawer = await screen.findByRole('dialog');
    expect(drawer.querySelector('.drawer-subtitle')).toBeNull();
    // It is said when it is another number than the serial.
    cleanup();
    get.mockImplementation(async (path: string) =>
      path === '/admin/users'
        ? USERS
        : path === '/admin/items'
          ? [item('A', { barcode: 'BLT-9000' })]
          : [],
    );
    window.location.hash = '#/admin/items?item=A';
    items();
    expect(await screen.findByText('BLT-9000', { selector: '.drawer-subtitle *' })).toBeInTheDocument();
  });

  it('tells inside the drawer why a save was refused, in the footer, where it is seen and read out', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/admin/items?item=A';
    patch.mockRejectedValueOnce(new Error('Unknown item class "tradng_card".'));
    items();
    const drawer = await screen.findByRole('dialog');
    const type = within(drawer).getByRole('textbox', { name: 'Type' });
    await user.clear(type);
    await user.type(type, 'tradng_card');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    const alert = await within(drawer).findByRole('alert');
    expect(alert).toHaveTextContent('Unknown item class');
    expect(drawer.querySelector('.drawer-foot')).toContainElement(alert);
  });

  it('offers the state the item is in even when it is one the list does not carry', async () => {
    window.location.hash = '#/admin/items?item=C';
    items();
    const drawer = await screen.findByRole('dialog');
    const lifecycle = within(drawer).getByRole('combobox', {
      name: 'Lifecycle',
    }) as HTMLSelectElement;
    expect(lifecycle.value).toBe('at_grader');
  });

  it('puts the item that was saved into the roll at once, with its new owner', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/admin/items?item=A';
    patch.mockResolvedValue({});
    items();
    const drawer = await screen.findByRole('dialog');
    const save = within(drawer).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.selectOptions(within(drawer).getByRole('combobox', { name: 'Owner' }), 'u2');
    await user.click(save);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/admin/items/A', { ownerId: 'u2' }));
    await waitFor(() =>
      expect(within(rows()[0]!).getByText('golden@bault.dev')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }),
      ).toBeDisabled(),
    );
  });
});
