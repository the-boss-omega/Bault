import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { TopUpPanel } = await import('../../apps/web/src/areas/customer/finance/MoneyPanels');

const route = (key: string, instant: boolean, available: boolean, instructions: unknown = null) => ({
  key,
  label: key,
  instant,
  feeBps: 0,
  description: '',
  available,
  instructions,
});

function catalogue(instantAvailable: boolean) {
  return {
    limits: { minMinor: 500, maxMinor: 500_000 },
    routes: [
      route('card', true, instantAvailable),
      route('paypal_gs', true, instantAvailable),
      route('paypal_ff', false, false),
      route('bank_transfer', false, true, { accountName: 'Bault Ltd', accountNumber: '12345678' }),
    ],
    referenceNote: 'Put your username in the payment reference.',
  };
}

function renderPanel() {
  return render(
    <I18nProvider>
      <TopUpPanel onError={() => {}} onStatus={() => {}} onChanged={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => get.mockReset());

describe('the top-up panel', () => {
  it('starts on a route that can be used, and offers no Pay button when instant top-up is unavailable', async () => {
    get.mockResolvedValue(catalogue(false));
    renderPanel();
    expect(await screen.findByText('Bault Ltd')).toBeInTheDocument();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('bank_transfer');
    expect(screen.queryByRole('button', { name: /pay now/i })).not.toBeInTheDocument();
  });

  it('offers the Pay button when the provider can take the payment', async () => {
    get.mockResolvedValue(catalogue(true));
    renderPanel();
    expect(await screen.findByRole('button', { name: /pay now/i })).toBeInTheDocument();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('card');
  });
});
