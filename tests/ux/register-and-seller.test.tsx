import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
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

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  get.mockReset();
  window.location.hash = '';
});

describe('the item sheet’s register', () => {
  const ITEM = {
    id: 'i1',
    serialNumber: 'SN-DR97-0001',
    barcode: 'SN-DR97-0001',
    typeClass: 'trading_card',
    description: 'Rayquaza ex #97/97',
    conditionGrade: 'PSA 9',
    lifecycleState: 'stored',
    binBarcode: 'BIN-BBBB2222',
    binZone: 'B',
    isLot: false,
    lotSize: 1,
    oversized: false,
  };
  const A = { barcode: 'BIN-AAAA1111', zone: 'A' };
  const B = { barcode: 'BIN-BBBB2222', zone: 'B' };
  const TIMELINE = [
    { at: '2026-10-03T10:00:00.000Z', kind: 'sale', params: { amountMinor: 26_000 } },
    { at: '2026-10-02T10:00:00.000Z', kind: 'relocate', params: { fromBin: A, toBin: B } },
    { at: '2026-10-01T10:00:00.000Z', kind: 'intake', params: { fromBin: null, toBin: A, fromState: null, toState: 'stored' } },
  ];

  function vaultApi(path: string) {
    if (path.endsWith('/timeline')) return Promise.resolve(TIMELINE);
    if (path.endsWith('/storage')) return Promise.reject(new Error('no storage in this test'));
    if (path.startsWith('/vault/items/')) return Promise.resolve({ images: [], openRequests: [] });
    if (path.startsWith('/vault/items')) return Promise.resolve([ITEM]);
    return Promise.resolve({ active: 1, hold: 0, history: 0 });
  }

  async function register(): Promise<HTMLElement> {
    const heading = await screen.findByRole('heading', { name: /item history|היסטוריית פריט/i });
    const column = heading.parentElement as HTMLElement;
    await waitFor(() => expect(within(column).getAllByRole('listitem').length).toBe(TIMELINE.length));
    return column;
  }

  it('reads in English with dollars and shelf labels, and no id', async () => {
    window.location.hash = '#/vault?item=i1';
    get.mockImplementation(vaultApi);
    renderIn(<VaultPage />);
    const column = await register();
    const text = column.textContent!.replace(/[⁨⁩]/g, '');
    expect(text).toContain('$260.00');
    expect(text).toContain('BIN-AAAA1111 · A → BIN-BBBB2222 · B');
    expect(text).toContain('Shelved in BIN-AAAA1111 · A');
    expect(text).not.toMatch(UUID);
    expect(text).not.toMatch(/cents/);
  });

  it('reads in Hebrew on a Hebrew page, and the entries are not forced left to right', async () => {
    localStorage.setItem('bault.locale', 'he');
    window.location.hash = '#/vault?item=i1';
    get.mockImplementation(vaultApi);
    renderIn(<VaultPage />);
    const column = await register();
    const text = column.textContent!.replace(/[⁨⁩]/g, '');
    expect(text).toContain('BIN-AAAA1111 · A ← BIN-BBBB2222 · B');
    expect(text).not.toMatch(/Shelved|Moved|recorded|cents/);
    for (const entry of column.querySelectorAll('.register-entry')) {
      expect(entry.classList.contains('ltr-run')).toBe(false);
    }
  });

  it('says a frozen card is frozen, without the machine’s note as its reason', async () => {
    window.location.hash = '#/vault/hold?item=i1';
    const frozen = { ...ITEM, holdFlag: true };
    const held = [{ at: '2026-10-04T10:00:00.000Z', kind: 'hold_placed', params: {} }, ...TIMELINE];
    get.mockImplementation((path: string) => {
      if (path.endsWith('/timeline')) return Promise.resolve(held);
      if (path.startsWith('/vault/items?') || path === '/vault/items') return Promise.resolve([frozen]);
      return vaultApi(path);
    });
    renderIn(<VaultPage />);
    expect(await screen.findByText(/This item is frozen and cannot move/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Put on hold').length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toMatch(/hold placed|admin edit/i);
  });
});

describe('the seller on a listing', () => {
  const LISTING = {
    id: 'l1',
    askingPrice: 12_300,
    currency: 'USD',
    itemId: 'i9',
    serialNumber: 'SN-GOLD-0001',
    typeClass: 'trading_card',
    conditionGrade: 'PSA 8',
    description: 'Gold Star Rayquaza',
    sellerUsername: 'golden',
  };

  function marketApi(path: string) {
    if (path.startsWith('/marketplace/listings')) return Promise.resolve([LISTING]);
    if (path === '/me/profile') return Promise.resolve({ id: 'u-red', username: 'red' });
    if (path.startsWith('/marketplace/sellers/')) {
      const who = path.split('/').pop();
      return Promise.resolve({ username: who, listings: who === 'golden' ? [LISTING] : [] });
    }
    return Promise.resolve([]);
  }

  it('names the seller on the card, linking to their storefront', async () => {
    window.location.hash = '#/marketplace/browse';
    get.mockImplementation(marketApi);
    renderIn(<MarketplacePage />);
    const link = await screen.findByRole('link', { name: /golden’s storefront|golden's storefront/i });
    expect(link).toHaveAttribute('href', '#/marketplace/store?seller=golden');
    expect(link.closest('li')).toHaveTextContent(/Sold by/);
    expect(link.closest('li')).toHaveTextContent('@golden');
  });

  it('opens the storefront the link names, not the visitor’s own', async () => {
    window.location.hash = '#/marketplace/store?seller=golden';
    get.mockImplementation(marketApi);
    renderIn(<MarketplacePage />);
    expect(await screen.findByRole('heading', { name: /golden’s storefront|golden's storefront/i })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/marketplace/sellers/golden'));
    expect(get).not.toHaveBeenCalledWith('/marketplace/sellers/red');
  });

  it('shows no seller line when a listing has none', async () => {
    window.location.hash = '#/marketplace/browse';
    get.mockImplementation((path: string) =>
      path.startsWith('/marketplace/listings')
        ? Promise.resolve([{ ...LISTING, sellerUsername: null }])
        : marketApi(path),
    );
    renderIn(<MarketplacePage />);
    await screen.findAllByText('Gold Star Rayquaza');
    expect(screen.queryByText(/Sold by/)).toBeNull();
  });
});
