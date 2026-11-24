import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { AccountingSection } = await import('../../apps/web/src/areas/admin/AccountingSection');

const REVERSIBLE = [
  {
    kind: 'wallet_request',
    id: 'wr-1',
    code: 'WR-AAAA1111',
    amount: 30_000,
    currency: 'USD',
    fundingSource: 'bank_transfer',
    completedAt: '2026-11-20T10:00:00.000Z',
    createdAt: '2026-11-19T10:00:00.000Z',
  },
  {
    kind: 'external_payment',
    id: 'pay-1',
    provider: 'paypal',
    providerRef: 'paypal_checkout:abc',
    amount: 5_000,
    currency: 'USD',
    createdAt: '2026-11-18T10:00:00.000Z',
  },
];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation(async (path: string) =>
    path === '/finance/chargebacks/reversible' ? REVERSIBLE : null,
  );
});

async function accounting() {
  render(
    <I18nProvider>
      <AccountingSection />
    </I18nProvider>,
  );
  await userEvent.setup().click(within(panel()).getByRole('button', { name: 'Show payments' }));
}

const panel = () =>
  screen.getByRole('heading', { name: 'Reversed payments', level: 2 }).closest('section') as HTMLElement;

describe('recording a chargeback from the accounting tab', () => {
  it('asks for nothing until the admin asks to see the payments', () => {
    render(
      <I18nProvider>
        <AccountingSection />
      </I18nProvider>,
    );
    expect(get).not.toHaveBeenCalled();
    expect(within(panel()).getByText('Show the settled cash-ins to find the one to reverse.')).toBeInTheDocument();
  });

  it('lists every settled cash-in that can be reversed, with what it credited', async () => {
    await accounting();
    await waitFor(() => expect(within(panel()).getAllByRole('row')).toHaveLength(3));
    expect(within(panel()).getByRole('row', { name: /Cash-in WR-AAAA1111/ })).toHaveTextContent('$300.00');
    expect(within(panel()).getByRole('row', { name: /paypal payment paypal_checkout:abc/ })).toHaveTextContent('$50.00');
  });

  it('asks for a reason, posts to the route for its kind, and says what was taken back', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ status: 'reversed', reversedMinor: 30_000, feeMinor: 2_500 });
    await accounting();
    const row = await within(await waitFor(panel)).findByRole('row', { name: /Cash-in WR-AAAA1111/ });
    await user.click(within(row).getByRole('button', { name: 'Record a chargeback' }));

    const form = screen.getByRole('form', { name: 'Chargeback on Cash-in WR-AAAA1111' });
    const submit = within(form).getByRole('button', { name: 'Record the chargeback' });
    expect(submit).toBeDisabled();
    await user.type(within(form).getByLabelText('Reason'), 'The bank recalled the transfer.');
    await user.type(within(form).getByLabelText('Case reference'), 'CASE-1');
    await user.click(submit);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/finance/chargebacks/wallet-requests/wr-1', {
        reason: 'The bank recalled the transfer.',
        providerCaseRef: 'CASE-1',
        chargeFee: true,
      }),
    );
    expect(
      await within(panel()).findByText(
        'Chargeback recorded on Cash-in WR-AAAA1111: $300.00 taken back and a $25.00 handling fee charged.',
      ),
    ).toBeInTheDocument();
    expect(get.mock.calls.filter(([p]) => p === '/finance/chargebacks/reversible')).toHaveLength(2);
  });

  it('records a provider payment by its id, and can leave the handling fee off', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ status: 'reversed', reversedMinor: 5_000, feeMinor: 0 });
    await accounting();
    const row = await within(await waitFor(panel)).findByRole('row', { name: /paypal payment/ });
    await user.click(within(row).getByRole('button', { name: 'Record a chargeback' }));
    const form = screen.getByRole('form');
    await user.type(within(form).getByLabelText('Reason'), 'Disputed with PayPal.');
    await user.click(within(form).getByRole('checkbox', { name: 'Charge the reversed-payment handling fee' }));
    await user.click(within(form).getByRole('button', { name: 'Record the chargeback' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/finance/chargebacks/pay-1', {
        reason: 'Disputed with PayPal.',
        providerCaseRef: undefined,
        chargeFee: false,
      }),
    );
    expect(await within(panel()).findByText(/\$50\.00 taken back\.$/)).toBeInTheDocument();
  });

  it('shows what the server refused, and keeps the form open', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error('This cash-in was already taken back.'));
    await accounting();
    const row = await within(await waitFor(panel)).findByRole('row', { name: /Cash-in WR-AAAA1111/ });
    await user.click(within(row).getByRole('button', { name: 'Record a chargeback' }));
    const form = screen.getByRole('form');
    await user.type(within(form).getByLabelText('Reason'), 'Recalled.');
    await user.click(within(form).getByRole('button', { name: 'Record the chargeback' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('This cash-in was already taken back.');
  });
});
