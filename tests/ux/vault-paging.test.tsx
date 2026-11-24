import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    put: vi.fn(),
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
const { VaultPage } = await import('../../apps/web/src/areas/customer/vault/VaultPage');
const { MarketplacePage } = await import('../../apps/web/src/areas/customer/marketplace/MarketplacePage');
const { ProposeTradePanel } = await import('../../apps/web/src/areas/customer/marketplace/ProposeTradePanel');
const { ShippingServicesPage } = await import('../../apps/web/src/areas/customer/shipping/ShippingServicesPage');
const { resetProfileRequest } = await import('../../apps/web/src/shared/session');

const CARDS = 120;
const day = 86_400_000;
const now = Date.now();

const cards = Array.from({ length: CARDS }, (_, i) => {
  const n = String(i).padStart(4, '0');
  return {
    id: `card-${n}`,
    serialNumber: `SN-PAGE-${n}`,
    typeClass: 'trading_card',
    description: `Paged card ${n}`,
    conditionGrade: 'Raw',
    lifecycleState: 'stored',
    holdFlag: false,
    isLot: false,
    lotSize: 1,
    lotBroken: false,
    receivedAt: new Date(now - (CARDS - i) * day).toISOString(),
    createdAt: new Date(now - (CARDS - i) * day).toISOString(),
  };
}).reverse();

const OLDEST = cards[cards.length - 1]!;

function pagedVault(path: string): unknown[] {
  const params = new URL(path, 'http://x').searchParams;
  const limit = Math.min(Number(params.get('limit') ?? 50), 500);
  const cursor = params.get('cursor');
  const start = cursor ? cards.findIndex((c) => c.id === cursor) + 1 : 0;
  return cards.slice(start, start + limit);
}

beforeEach(() => {
  get.mockReset();
  resetProfileRequest();
  localStorage.clear();
  get.mockImplementation((path: string) => {
    if (path.startsWith('/vault/items/')) return Promise.resolve({ images: [], openRequests: [] });
    if (path.startsWith('/vault/items')) return Promise.resolve(pagedVault(path));
    if (path.startsWith('/vault/counts')) return Promise.resolve({ active: CARDS, hold: 0, history: 0 });
    if (path === '/me/profile') return Promise.resolve({ id: 'u-red', username: 'red' });
    if (path.startsWith('/services/remove-commons/window')) return Promise.resolve({ windowDays: 30 });
    return Promise.resolve([]);
  });
});

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe('a vault of 120 cards, more than one page of the API', () => {
  it('shows every card in the grid, counts them all, and sorts the oldest to the front', async () => {
    window.location.hash = '#/vault';
    wrap(<VaultPage />);
    await waitFor(() => expect(document.querySelectorAll('.card-grid .card-title')).toHaveLength(CARDS));
    expect(screen.getByText(`${CARDS} items`)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'oldest');
    await waitFor(() =>
      expect(document.querySelector('.card-grid .card-title')?.textContent).toBe(OLDEST.serialNumber),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Select to ship' }));
    const bar = screen.getByRole('region', { name: 'Items picked to ship' });
    expect(within(bar).getByRole('button', { name: `Pick all ${CARDS} that can ship` })).toBeInTheDocument();
  });

  it('lets Sell open on the oldest card', async () => {
    window.location.hash = `#/marketplace/sell?item=${OLDEST.id}`;
    wrap(<MarketplacePage />);
    const radio = await screen.findByRole('radio', { name: new RegExp(OLDEST.serialNumber) });
    await waitFor(() => expect(radio).toBeChecked());
  });

  it('offers every card in a trade', async () => {
    wrap(<ProposeTradePanel onProposed={() => {}} onError={() => {}} />);
    const offered = await screen.findByRole('group', { name: 'What you offer' });
    await waitFor(() => expect(within(offered).getAllByRole('checkbox')).toHaveLength(CARDS));
    expect(within(offered).getByRole('checkbox', { name: new RegExp(OLDEST.serialNumber) })).toBeInTheDocument();
  });

  it('lets the shipment composer pick the oldest card', async () => {
    window.location.hash = '#/shipping-services/shipping';
    wrap(<ShippingServicesPage />);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: new RegExp(OLDEST.serialNumber) })).toBeInTheDocument(),
    );
    expect(get.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/vault/items?'))).toContain(
      '/vault/items?limit=500',
    );
  });
});
