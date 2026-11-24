import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const get = vi.fn();

class MockApiError extends Error {
  constructor(
    readonly kind: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: MockApiError,
  apiErrorKey: () => null,
  isUnreachable: () => false,
  onSessionEnded: () => undefined,
}));

const { default: App } = await import('../../apps/web/src/App');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ThemeProvider } = await import('../../apps/web/src/shared/theme');

const shell = () =>
  render(
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>,
  );

const COLLECTOR = {
  id: 'me',
  role: 'user',
  status: 'active',
  email: 'dana@bault.dev',
  username: 'dana',
  firstName: 'Dana',
  lastName: 'Okonkwo',
  fullName: 'Dana Okonkwo',
  nameReviewRequired: false,
  mfaRequired: false,
  mfaEnabled: false,
};

const rail = () => screen.getByRole('navigation', { name: /primary/i });
const railLabels = () =>
  Array.from(rail().querySelectorAll('.rail-nav:not(.rail-nav--foot) .rail-label')).map((el) => el.textContent);

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
  get.mockImplementation(async (path: string) => {
    if (path === '/me/profile') return COLLECTOR;
    if (path === '/escrow/terms') return { feeBps: 300, minimumFeeMinor: 500, minimumValueMinor: 10_000 };
    if (path === '/escrow/held') return { heldMinor: 0 };
    return [];
  });
});

describe('the house store and escrow as sections of their own', () => {
  it('puts Store and Escrow in a collector\'s rail, right after the marketplace', async () => {
    window.location.hash = '#/vault';
    shell();
    await waitFor(() => expect(railLabels()).toContain('Store'));
    const labels = railLabels();
    const at = labels.indexOf('Marketplace');
    expect(labels.slice(at, at + 3)).toEqual(['Marketplace', 'Store', 'Escrow']);
  });

  it('sends an old link to the marketplace house store tab to the store', async () => {
    window.location.hash = '#/marketplace/house';
    shell();
    await waitFor(() => expect(window.location.hash).toBe('#/store'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/marketplace/house/listings'));
    expect(within(rail()).getByRole('button', { name: 'Store' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Card Embassy store' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('sends an old link to the marketplace escrow tab to escrow', async () => {
    window.location.hash = '#/marketplace/escrow';
    shell();
    await waitFor(() => expect(window.location.hash).toBe('#/escrow'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/escrow/mine'));
    expect(within(rail()).getByRole('button', { name: 'Escrow' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('leaves the marketplace with its own tabs only, the collector storefront still among them', async () => {
    window.location.hash = '#/marketplace/browse';
    shell();
    const tabs = await screen.findByRole('tablist', { name: 'Marketplace' });
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Browse',
      'Sell',
      'My listings',
      'Offers',
      'Trade',
      'Storefront',
    ]);
  });
});
