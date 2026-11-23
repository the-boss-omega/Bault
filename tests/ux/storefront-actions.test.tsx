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

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { MarketplacePage } = await import('../../apps/web/src/areas/customer/marketplace/MarketplacePage');
const { resetProfileRequest } = await import('../../apps/web/src/shared/session');

const ROW = (id: string, serial: string, description: string, price: number) => ({
  id,
  itemId: `item-${id}`,
  askingPrice: price,
  currency: 'USD',
  publishedAt: '2026-11-01T10:00:00.000Z',
  serialNumber: serial,
  typeClass: 'trading_card',
  description,
  conditionGrade: 'PSA 9',
});

const STORE = [
  ROW('l1', 'SN-GOLD-0001', 'Gold Star Rayquaza', 12_300),
  ROW('l2', 'SN-DR97-0001', 'Rayquaza ex', 4_500),
];

function marketApi(me: string) {
  return (path: string) => {
    if (path === '/me/profile') return Promise.resolve({ id: `u-${me}`, username: me });
    if (path === '/marketplace/sellers/golden') return Promise.resolve({ username: 'golden', listings: STORE });
    if (path === '/marketplace/collectors/golden') {
      return Promise.resolve({ username: 'golden' });
    }
    return Promise.resolve([]);
  };
}

async function openStore(me: string) {
  get.mockImplementation(marketApi(me));
  window.location.hash = '#/marketplace/store?seller=golden';
  render(
    <I18nProvider>
      <MarketplacePage />
    </I18nProvider>,
  );
  await screen.findByRole('heading', { name: /golden's storefront/i });
  await screen.findByText('Gold Star Rayquaza');
  await waitFor(() => expect(get).toHaveBeenCalledWith('/me/profile'));
}

function card(text: string): HTMLElement {
  return screen.getByText(text).closest('li') as HTMLElement;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  resetProfileRequest();
  window.location.hash = '';
});

describe('a storefront seen by a visitor', () => {
  it('offers Buy and Propose a trade on every card', async () => {
    await openStore('red');
    for (const name of ['Gold Star Rayquaza', 'Rayquaza ex']) {
      const li = card(name);
      expect(await within(li).findByRole('button', { name: 'Buy' })).toBeInTheDocument();
      expect(within(li).getByRole('button', { name: 'Make offer' })).toBeInTheDocument();
      expect(within(li).getByRole('button', { name: 'Propose a trade' })).toBeInTheDocument();
    }
  });

  it('buys through the same confirmation Browse uses, then says so and reloads the store', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({});
    await openStore('red');
    await user.click(await within(card('Gold Star Rayquaza')).findByRole('button', { name: 'Buy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    expect(dialog.textContent!.replace(/[⁨⁩]/g, '')).toContain('Gold Star Rayquaza for $123.00');
    get.mockClear();
    await user.click(within(dialog).getByRole('button', { name: 'Buy' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/marketplace/listings/l1/purchase'));
    expect(await screen.findByText(/^Bought .*Gold Star Rayquaza.* for \$123\.00\. It is in your vault now\.$/)).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/marketplace/sellers/golden'));
  });

  it('shows a refused purchase in the confirmation, which stays open to try again or cancel', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error('Insufficient funds'));
    await openStore('red');
    await user.click(await within(card('Gold Star Rayquaza')).findByRole('button', { name: 'Buy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    await user.click(within(dialog).getByRole('button', { name: 'Buy' }));
    expect(await within(dialog).findByText('Insufficient funds')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Confirm purchase' })).toBeInTheDocument();
  });

  it('opens the same offer drawer Browse opens, with the asking price and the seller', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({});
    await openStore('red');
    await user.click(await within(card('Rayquaza ex')).findByRole('button', { name: 'Make offer' }));
    const drawer = await screen.findByRole('dialog', { name: 'Make an offer' });
    const amount = within(drawer).getByLabelText('Offer amount');
    expect(amount).toHaveValue('45.00');
    expect(drawer).toHaveTextContent('@golden');
    await user.clear(amount);
    await user.type(amount, '40');
    await user.click(within(drawer).getByRole('button', { name: 'Send offer' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/marketplace/listings/l2/offers', { amount: 4_000 }),
    );
  });

  it('goes to the trade tab with the seller and the serial filled in', async () => {
    const user = userEvent.setup();
    await openStore('red');
    await user.click(
      await within(card('Rayquaza ex')).findByRole('button', { name: 'Propose a trade' }),
    );
    expect(window.location.hash).toBe('#/marketplace/trade?with=golden&serial=SN-DR97-0001');
    expect(await screen.findByLabelText('Username')).toHaveValue('golden');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/marketplace/collectors/golden'));
    expect(await screen.findByLabelText('Serial of the item you want')).toHaveValue('SN-DR97-0001');
  });
});

describe('a storefront seen by its seller', () => {
  it('offers neither Buy nor Propose a trade', async () => {
    await openStore('golden');
    await screen.findByText(/Your storefront link/);
    expect(screen.queryByRole('button', { name: 'Buy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make offer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Propose a trade' })).toBeNull();
  });
});
