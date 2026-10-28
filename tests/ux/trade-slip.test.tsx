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

/** One side of the slip: what the other person gets ('give') or what you get ('get'). */
const side = (slip: HTMLElement, area: 'give' | 'get') => slip.querySelector(`.trade-side--${area}`) as HTMLElement;

describe('a trade, written on a slip as it is composed', () => {
  it('has the two sides of it, empty, before anything is chosen', async () => {
    proposal();
    const slip = await screen.findByRole('region', { name: 'Propose a trade' });
    expect(side(slip, 'give')).toHaveTextContent('—');
    expect(side(slip, 'get')).toHaveTextContent('—');
    expect(within(slip).getByText('With').nextElementSibling).toHaveTextContent('—');
    expect(slip).toHaveTextContent('Swap');
    expect(slip).toHaveTextContent('Both sides must approve before ownership moves.');
  });

  it('puts what you offer on their side, who it is with, and what you ask for on yours', async () => {
    proposal();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Propose a trade' });

    await user.click(await screen.findByRole('checkbox', { name: /SN-CL10-0005/ }));
    expect(side(slip, 'give')).toHaveTextContent('SN-CL10-0005');

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'golden');
    await user.click(screen.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(within(slip).getByText('With').nextElementSibling).toHaveTextContent('@golden'));

    await user.type(screen.getByRole('textbox', { name: 'Serial of the item you want' }), 'SN-DX102-0002');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(side(slip, 'get')).toHaveTextContent('SN-DX102-0002'));

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
    expect(side(slip, 'give')).toHaveTextContent('SN-CL10-0005');
    expect(side(slip, 'get')).toHaveTextContent('—');
    // One way, toward the side that receives: the glyph says so by its class, and the two groups say it in words.
    expect(slip.querySelector('.trade-swap--one')).not.toBeNull();
  });

  it('takes no part in the keyboard: the cards on it are not buttons, and its sides are not groups called what the fields are', async () => {
    proposal();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Propose a trade' });
    await user.click(await screen.findByRole('checkbox', { name: /SN-CL10-0005/ }));
    await user.click(await screen.findByRole('checkbox', { name: /SN-DR97-0001/ }));
    // Two cards are chosen, and the slip has no control in it: Tab goes from the fields to the button that sends.
    expect(within(slip).queryAllByRole('button')).toHaveLength(0);
    expect(slip.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')).toHaveLength(0);
    // The picker is the one group called "They get"; the slip says it in words beside it.
    expect(screen.getAllByRole('group', { name: 'They get' })).toHaveLength(1);
    expect(side(slip, 'give')).toHaveTextContent('They get');
    expect(side(slip, 'give')).toHaveTextContent('SN-CL10-0005');
  });
});
