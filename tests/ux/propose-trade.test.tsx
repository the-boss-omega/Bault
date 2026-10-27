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
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { ProposeTradePanel } = await import('../../apps/web/src/areas/customer/marketplace/ProposeTradePanel');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const item = (id: string, serial: string, description: string) => ({
  id,
  serialNumber: serial,
  typeClass: 'trading_card',
  description,
  conditionGrade: null,
  lifecycleState: 'stored',
  barcode: `BC-${id}`,
});

const ITEMS = [
  item('i1', 'SN-CL10-0005', '2011 Pokémon Call of Legends — Rayquaza'),
  item('i2', 'SN-DR97-0001', '2003 Pokémon EX Dragon — Rayquaza ex'),
  item('i3', 'SN-DX107-0003', '2005 Pokémon EX Deoxys — Rayquaza ★'),
];

async function renderPanel() {
  get.mockImplementation((path: string) => {
    if (path === '/vault/items') return Promise.resolve(ITEMS);
    if (path === '/marketplace/collectors/blue') {
      return Promise.resolve({ id: 'u2', username: 'blue', firstName: null, lastName: null });
    }
    return Promise.resolve([]);
  });
  const onProposed = vi.fn();
  render(
    <I18nProvider>
      <ProposeTradePanel onProposed={onProposed} onError={() => {}} />
    </I18nProvider>,
  );
  const offered = await screen.findByRole('group', { name: 'They get' });
  return { onProposed, offered };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('proposing a trade', () => {
  it('lets a swap be of several cards, named as a group', async () => {
    const user = userEvent.setup();
    const { offered } = await renderPanel();

    const boxes = within(offered).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    await user.click(boxes[0]!);
    await user.click(boxes[1]!);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();
  });

  it('makes a gift of one card, as radios, so choosing another says it lets go of the first', async () => {
    const user = userEvent.setup();
    const { offered } = await renderPanel();

    await user.click(within(offered).getAllByRole('checkbox')[0]!);
    await user.click(within(offered).getAllByRole('checkbox')[1]!);
    await user.click(screen.getByRole('checkbox', { name: /Send as a gift/ }));

    const radios = within(offered).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(within(offered).queryByRole('checkbox')).not.toBeInTheDocument();
    // Of the two that were ticked for a swap, the first is the one the gift is of.
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([true, false, false]);

    await user.click(radios[2]!);
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, false, true]);
  });

  it('sends the card that is chosen, and only that one', async () => {
    const user = userEvent.setup();
    post.mockResolvedValueOnce({ confirmationToken: 'tok' }).mockResolvedValueOnce({});
    const { onProposed, offered } = await renderPanel();

    await user.type(screen.getByRole('textbox', { name: /Username/ }), 'blue');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await screen.findByText('Found');

    await user.click(screen.getByRole('checkbox', { name: /Send as a gift/ }));
    await user.click(within(offered).getByRole('radio', { name: /SN-DR97-0001/ }));
    await user.click(screen.getByRole('button', { name: 'Send gift' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/marketplace/transfers', { itemId: 'i2', toUsername: 'blue' }),
    );
    await waitFor(() => expect(onProposed).toHaveBeenCalled());
  });
});
