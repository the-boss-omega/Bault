import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

const { LandingPage } = await import('../../apps/web/src/areas/customer/marketing/LandingPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const PRICE_LIST = {
  groups: [
    {
      group: 'intake',
      entries: [
        { actionType: 'intake', model: 'fixed', value: 500, parameters: null },
        {
          actionType: 'storage',
          model: 'fixed',
          value: 100,
          parameters: { freeDays: 180, periodDays: 90, percentOfIntakeBps: 1_000 },
        },
      ],
    },
    {
      group: 'shipping',
      entries: [{ actionType: 'shipping', model: 'fixed', value: 0, parameters: null }],
    },
    {
      group: 'selling',
      entries: [{ actionType: 'marketplace_fee', model: 'percentage', value: 500, parameters: null }],
    },
    {
      group: 'money',
      entries: [{ actionType: 'cash_out_fee', model: 'percentage', value: 150, parameters: null }],
    },
  ],
};

const TERMS = {
  cashOut: { bandMinor: 10_000, smallBps: 600, smallMinimumMinor: 99, largeFixedMinor: 500, largeBps: 100 },
};

function answer({ terms = (): Promise<unknown> => Promise.resolve(TERMS) } = {}) {
  get.mockImplementation((path: string) => {
    if (path === '/pricing/list') return Promise.resolve(PRICE_LIST);
    if (path === '/content/account-terms') return terms();
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <LandingPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  window.location.hash = '';
});

describe('the landing page', () => {
  it('opens on a real item, with its serial, not on an illustration', async () => {
    answer();
    renderPage();

    expect(screen.getByText('SN-DX107-0003')).toBeInTheDocument();

    const photo = document.querySelector('img');
    expect(photo).toBeTruthy();
    expect(photo!.getAttribute('src')).toContain('SN-DX107-0003');

    await screen.findByText('$5.00');
  });

  it('prices itself from the pricing rules, never from a figure typed into the page', async () => {
    answer();
    renderPage();

    await waitFor(() => expect(get).toHaveBeenCalledWith('/pricing/list'));

    expect(await screen.findByText('$5.00')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();

    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('states the storage terms from the rule parameters, not from its fallback value', async () => {
    answer();
    renderPage();

    expect(
      await screen.findByText('180 days included, then 10% of the intake fee every 90 days'),
    ).toBeInTheDocument();
    expect(screen.queryByText('$1.00')).not.toBeInTheDocument();
  });

  it('states the cash-out fee from the schedule the charge uses, not from the price-list rule', async () => {
    answer();
    renderPage();

    await waitFor(() => expect(get).toHaveBeenCalledWith('/content/account-terms'));
    const row = (await screen.findByText('Taking money out')).closest('tr')!;
    await waitFor(() =>
      expect(row).toHaveTextContent('6% (at least $0.99) up to $100.00; above that, $5.00 plus 1%'),
    );
    expect(screen.queryByText('1.50%')).not.toBeInTheDocument();
  });

  it('says the cash-out figures are loading until they arrive', async () => {
    answer({ terms: () => new Promise(() => {}) });
    renderPage();

    const row = (await screen.findByText('Taking money out')).closest('tr')!;
    await screen.findByText('$5.00');
    expect(row).toHaveTextContent('Loading…');
    expect(row).not.toHaveTextContent('%');
  });

  it('shows no cash-out figure when the terms cannot be fetched, and the other prices still', async () => {
    answer({ terms: () => Promise.reject(new Error('unreachable')) });
    renderPage();

    const row = (await screen.findByText('Taking money out')).closest('tr')!;
    await waitFor(() => expect(row).toHaveTextContent(/not available just now/i));
    expect(row).not.toHaveTextContent('%');
    expect(screen.getByText('$5.00')).toBeInTheDocument();
  });

  it('shows no figure at all when the price list cannot be fetched', async () => {
    get.mockRejectedValue(new Error('unreachable'));
    renderPage();

    expect(await screen.findByText(/price list could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText('$5.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('sends "Open an account" to sign-up and "Sign in" to sign-in', async () => {
    const user = userEvent.setup();
    answer();
    renderPage();

    const bar = document.querySelector('.landing-bar') as HTMLElement;
    await user.click(within(bar).getByRole('button', { name: /open an account/i }));
    expect(window.location.hash).toBe('#/signup');

    await user.click(within(bar).getByRole('button', { name: /^sign in$/i }));
    expect(window.location.hash).toBe('#/signin');
  });

  it('is one h1 followed by section headings, so it can be read by outline', async () => {
    answer();
    renderPage();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('region').length).toBeGreaterThanOrEqual(5);

    await screen.findByText('$5.00');
  });
});
