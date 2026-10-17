import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The accountant's buttons and the pricing-coverage check, in the admin console.
 * The figures are the API's; what is checked here is that each
 * button asks for the right report and that what comes back is shown.
 */

const get = vi.fn();

vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { AccountingSection } = await import('../../apps/web/src/areas/admin/AccountingSection');
const { PricingCoveragePanel } = await import('../../apps/web/src/areas/admin/PricingCoveragePanel');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  get.mockReset();
  try {
    localStorage.setItem('bault.locale', 'en');
  } catch {
    /* jsdom always has it */
  }
});

describe('admin accounting', () => {
  it('downloads the ledger as a link to the CSV for the chosen days', async () => {
    const user = userEvent.setup();
    renderIn(<AccountingSection onError={() => {}} />);
    const link = screen.getByRole('link', { name: /download csv/i });
    expect(link.getAttribute('href')).toMatch(
      /^\/api\/v1\/admin\/accounting\/ledger\.csv\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/,
    );

    const [from] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-01$/);
    await user.clear(from!);
    await user.type(from!, '2026-01-01');
    expect(screen.getByRole('link', { name: /download csv/i }).getAttribute('href')).toContain('from=2026-01-01');
  });

  it('shows the month summary with revenue apart from customer money', async () => {
    const user = userEvent.setup();
    get.mockResolvedValueOnce({
      month: '2026-10',
      currency: 'USD',
      byType: [{ type: 'fee', direction: 'debit', count: 2, totalMinor: 700 }],
      revenue: { totalMinor: 700, lines: [{ key: 'cash_out_fee', totalMinor: 700 }], carrierCostOnShippingChargesMinor: 0 },
      customerMoney: { inMinor: 50_000, outMinor: 20_000, reversedMinor: 0, netMinor: 30_000 },
      balancesHeld: {
        asOf: '2026-10-15T00:00:00.000Z',
        customerTotalMinor: 29_300,
        owedToCustomersMinor: 29_300,
        owedByCustomersMinor: 0,
        accountsWithBalance: 1,
        platformAccountMinor: 0,
      },
      note: '',
    });
    renderIn(<AccountingSection onError={() => {}} />);
    await user.click(screen.getByRole('button', { name: /show summary/i }));

    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/accounting\/summary\?month=\d{4}-\d{2}$/)));
    expect(await screen.findByText('Bault revenue')).toBeInTheDocument();
    expect(screen.getByText('Customer money in')).toBeInTheDocument();
    expect(screen.getByText('Customer balances held')).toBeInTheDocument();
    expect(screen.getByText('Cash-out fees')).toBeInTheDocument();
  });

  it('runs the reconciliation and lists each difference', async () => {
    const user = userEvent.setup();
    get.mockResolvedValueOnce({
      checked: { topups: 3, payouts: 1, withdrawals: 2 },
      matched: 3,
      mismatches: [
        {
          kind: 'withdrawal_without_payout',
          detail: 'Money left this wallet and no payout at any provider records it leaving Bault.',
          paymentId: null,
          ledgerId: 'l-1',
          username: 'golden',
          expectedMinor: 100_000,
          recordedMinor: 100_000,
          at: '2026-10-15T00:00:00.000Z',
        },
      ],
      pending: [],
      manualCashIns: { count: 4, totalMinor: 10_000 },
    });
    renderIn(<AccountingSection onError={() => {}} />);
    await user.click(screen.getByRole('button', { name: /run reconciliation/i }));

    await waitFor(() => expect(get).toHaveBeenCalledWith('/admin/accounting/reconciliation'));
    expect(await screen.findByText('1 differences')).toBeInTheDocument();
    expect(screen.getByText('withdrawal_without_payout')).toBeInTheDocument();
    expect(screen.getByText('golden')).toBeInTheDocument();
  });
});

describe('admin pricing coverage', () => {
  it('says plainly when a price is missing, and puts it first', async () => {
    get.mockResolvedValueOnce({
      ready: false,
      summary: { total: 2, priced: 1, missing: 1, fallingBack: 0, codeDefault: 0, free: 0, codeConstant: 0 },
      actions: [
        { actionType: 'intake', resolution: 'required', fallsBackTo: null, status: 'priced', description: 'x', rule: { model: 'fixed', value: 500 } },
        { actionType: 'storage', resolution: 'required', fallsBackTo: null, status: 'missing', description: 'y', rule: null },
      ],
      unknownRules: [],
    });
    renderIn(<PricingCoveragePanel refreshKey={0} onError={() => {}} />);

    expect(await screen.findByText('Prices are missing')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/admin/pricing/coverage');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('storage');
    expect(rows[0]).toHaveTextContent('Missing — the action fails');
    expect(rows[1]).toHaveTextContent('$5.00');
  });
});
