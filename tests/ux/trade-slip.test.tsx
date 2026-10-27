import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  apiErrorKey: () => null,
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ProposeTradePanel } = await import('../../apps/web/src/areas/customer/marketplace/ProposeTradePanel');

const MINE = [
  { id: 'i1', serialNumber: 'SN-CL10-0005', typeClass: 'trading_card', description: '2011 Pokémon Call of Legends — Rayquaza', conditionGrade: null, lifecycleState: 'stored', barcode: 'b1' },
  { id: 'i2', serialNumber: 'SN-DR97-0001', typeClass: 'trading_card', description: '2003 Pokémon EX Dragon — Rayquaza', conditionGrade: null, lifecycleState: 'stored', barcode: 'b2' },
];
const THEIRS = { id: 'w1', serialNumber: 'SN-DX102-0002', typeClass: 'trading_card', description: '2005 Pokémon EX Deoxys — Rayquaza ex', ownerUsername: 'golden' };

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  get.mockImplementation(async (path: string) => {
    if (path === '/vault/items') return MINE;
    if (path === '/marketplace/collectors/golden') return { id: 'u2', username: 'golden', firstName: 'Golden', lastName: 'Marsh' };
    if (path.startsWith('/marketplace/collectors/golden/items/')) return THEIRS;
    return [];
  });
  post.mockResolvedValue({});
});

function proposal() {
  return render(
    <I18nProvider>
      <ProposeTradePanel onProposed={async () => {}} onError={() => {}} />
    </I18nProvider>,
  );
}

describe('a trade, written on a slip as it is composed', () => {
  it('has the two sides of it, empty, before anything is chosen', async () => {
    proposal();
    const slip = await screen.findByRole('region', { name: 'Propose a trade' });
    expect(within(slip).getByRole('group', { name: 'They get' })).toHaveTextContent('—');
    expect(within(slip).getByRole('group', { name: 'You get' })).toHaveTextContent('—');
    expect(within(slip).getByText('With').nextElementSibling).toHaveTextContent('—');
    expect(slip).toHaveTextContent('Swap');
    expect(slip).toHaveTextContent('Both sides must approve before ownership moves.');
  });

  it('puts what you offer on their side, who it is with, and what you ask for on yours', async () => {
    proposal();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Propose a trade' });

    await user.click(await screen.findByRole('checkbox', { name: /SN-CL10-0005/ }));
    expect(within(slip).getByRole('group', { name: 'They get' })).toHaveTextContent('SN-CL10-0005');

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'golden');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(within(slip).getByText('With').nextElementSibling).toHaveTextContent('@golden'));

    await user.type(screen.getByRole('textbox', { name: 'Serial of the item you want' }), 'SN-DX102-0002');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(within(slip).getByRole('group', { name: 'You get' })).toHaveTextContent('SN-DX102-0002'));

    await user.click(screen.getByRole('button', { name: 'Send proposal' }));
    expect(post).toHaveBeenCalledWith('/marketplace/swaps', {
      responderUsername: 'golden',
      offeredItemIds: ['i1'],
      requestedItemIds: ['w1'],
    });
  });

  it('is a gift when it is sent as one: one card, one way, and nothing on your side', async () => {
    proposal();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Propose a trade' });
    await user.click(await screen.findByRole('checkbox', { name: /SN-CL10-0005/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Send as a gift (nothing in return)' }));

    expect(slip).toHaveTextContent('Gift');
    expect(slip).toHaveTextContent('A gift moves one item.');
    expect(within(slip).getByRole('group', { name: 'They get' })).toHaveTextContent('SN-CL10-0005');
    expect(within(slip).getByRole('group', { name: 'You get' })).toHaveTextContent('—');
    // One way, toward the side that receives: the glyph says so by its class, and the two groups say it in words.
    expect(slip.querySelector('.trade-swap--one')).not.toBeNull();
  });
});
