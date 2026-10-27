import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: vi.fn(async () => []), post: (...a: unknown[]) => post(...a), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  apiErrorKey: () => null,
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider, useT } = await import('../../apps/web/src/shared/i18n');
const { SellPanel } = await import('../../apps/web/src/areas/customer/marketplace/MarketplacePage');

const ITEMS = [
  {
    id: 'i1',
    serialNumber: 'SN-CL10-0005',
    typeClass: 'trading_card',
    description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo (Shiny Legendary subset) · art by Noriko Hotta',
  },
  { id: 'i2', serialNumber: 'SN-DR97-0001', typeClass: 'trading_card', description: '2003 Pokémon EX Dragon — Rayquaza ex #97/97' },
];

function Panel() {
  const t = useT();
  return <SellPanel items={ITEMS} t={t} onListed={async () => {}} onError={() => {}} />;
}

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({});
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
});

function sell() {
  return render(
    <I18nProvider>
      <Panel />
    </I18nProvider>,
  );
}

describe('selling an item, written on a slip while it is priced', () => {
  it('shows the card chosen, its serial and the price asked, and follows both as they change', async () => {
    sell();
    const user = userEvent.setup();
    const slip = screen.getByRole('region', { name: 'Asking price' });
    expect(slip.querySelector('.drawer-tag-amount')).toHaveTextContent('$500.00');
    expect(within(slip).getByText('Serial').nextElementSibling).toHaveTextContent('SN-CL10-0005');
    // The card's name, not the whole catalogue line.
    expect(within(slip).getByText('Item').nextElementSibling).toHaveTextContent('2011 Pokémon Call of Legends — Rayquaza #SL10/95');
    expect(slip).not.toHaveTextContent('Noriko Hotta');
    expect(within(slip).getByText('Active')).toBeInTheDocument();

    const price = screen.getByRole('textbox', { name: 'Asking price' });
    await user.clear(price);
    await user.type(price, '1250');
    expect(slip.querySelector('.drawer-tag-amount')).toHaveTextContent('$1,250.00');

    await user.click(screen.getByRole('radio', { name: /SN-DR97-0001/ }));
    expect(within(slip).getByText('Serial').nextElementSibling).toHaveTextContent('SN-DR97-0001');
  });

  it('writes no price while what is typed is not one, and does not let it be sent', async () => {
    sell();
    const user = userEvent.setup();
    const slip = screen.getByRole('region', { name: 'Asking price' });
    const price = screen.getByRole('textbox', { name: 'Asking price' });
    await user.clear(price);
    await user.type(price, 'abc');
    expect(slip.querySelector('.drawer-tag-amount')).toHaveTextContent('$0.00');
    expect(screen.getByRole('button', { name: 'List for sale' })).toBeDisabled();
  });

  it('lists what the slip shows, at the price it shows', async () => {
    sell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /SN-DR97-0001/ }));
    const price = screen.getByRole('textbox', { name: 'Asking price' });
    await user.clear(price);
    await user.type(price, '1250');
    await user.click(screen.getByRole('button', { name: 'List for sale' }));
    expect(post).toHaveBeenCalledWith('/marketplace/listings', { itemId: 'i2', askingPrice: 125000 });
  });
});
