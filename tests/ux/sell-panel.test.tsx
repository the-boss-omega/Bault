import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve([])),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { SellPanel } = await import('../../apps/web/src/areas/customer/marketplace/MarketplacePage');
const { I18nProvider, useI18n } = await import('../../apps/web/src/shared/i18n');

const ITEMS = [
  { id: 'i1', serialNumber: 'SN-CL10-0005', typeClass: 'trading_card', description: '2011 Pokémon Call of Legends — Rayquaza' },
  { id: 'i2', serialNumber: 'SN-DR97-0001', typeClass: 'trading_card', description: '2003 Pokémon EX Dragon — Rayquaza ex' },
];

function Panel({ items, onListed }: { items: typeof ITEMS; onListed: () => Promise<void> }) {
  const { t } = useI18n();
  return <SellPanel items={items} t={t} onListed={onListed} onError={() => {}} />;
}

function renderSell(items = ITEMS) {
  const onListed = vi.fn(() => Promise.resolve());
  render(
    <I18nProvider>
      <Panel items={items} onListed={onListed} />
    </I18nProvider>,
  );
  return { onListed };
}

beforeEach(() => {
  post.mockReset();
});

describe('selling a card', () => {
  it('chooses the card from the cards, one of them, the first to begin with', async () => {
    renderSell();

    const group = await screen.findByRole('group', { name: 'Item to sell' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked') ?? String((r as HTMLInputElement).checked))).toEqual([
      'true',
      'false',
    ]);
    expect(within(group).getByRole('radio', { name: /SN-CL10-0005/ })).toBeChecked();
    expect(within(group).getByRole('radio', { name: /SN-DR97-0001/ })).not.toBeChecked();
  });

  it('lists the chosen card at the price it was given', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({});
    const { onListed } = renderSell();

    await user.click(await screen.findByRole('radio', { name: /SN-DR97-0001/ }));
    const price = screen.getByRole('textbox', { name: 'Asking price' });
    await user.clear(price);
    await user.type(price, '1250');
    expect(screen.getByText('Lists at $1,250.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'List for sale' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/marketplace/listings', { itemId: 'i2', askingPrice: 125_000 }));
    await waitFor(() => expect(onListed).toHaveBeenCalled());
  });

  it('will not list at a price that is not a price', async () => {
    const user = userEvent.setup();
    renderSell();

    const price = await screen.findByRole('textbox', { name: 'Asking price' });
    await user.clear(price);
    await user.type(price, 'lots');

    expect(screen.getByRole('button', { name: 'List for sale' })).toBeDisabled();
  });

  it('says so when no card can be sold', () => {
    renderSell([]);
    expect(screen.getByText('No stored items available in your vault.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
