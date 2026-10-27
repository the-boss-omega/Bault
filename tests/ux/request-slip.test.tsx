import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { DrawerTag } = await import('../../apps/web/src/shared/ui/DrawerTag');
const { WalletRequestForm } = await import('../../apps/web/src/areas/customer/finance/WalletRequestForms');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async () => null);
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
});

const QUOTE = {
  amountMinor: 250000,
  feeMinor: 3000,
  netMinor: 247000,
  schedule: { bandMinor: 10000, smallBps: 600, smallMinimumMinor: 99, largeFixedMinor: 500, largeBps: 100 },
};

function cashOut() {
  return render(
    <I18nProvider>
      <WalletRequestForm type="cash_out" availableMinor={970000} existingRequests={[]} onSubmitted={() => {}} />
    </I18nProvider>,
  );
}

describe('a tag with lines', () => {
  it('sets each as a name and its value, and has no amount when it has none', () => {
    render(
      <I18nProvider>
        <DrawerTag kicker="Where to send it" lines={[{ label: 'IBAN', value: 'GB29 NWBK 6016' }, { label: 'SWIFT', value: 'NWBKGB2L' }]} />
      </I18nProvider>,
    );
    const tag = screen.getByRole('region', { name: 'Where to send it' });
    expect(tag.querySelector('.drawer-tag-amount')).toBeNull();
    expect(within(tag).getByText('IBAN').nextElementSibling).toHaveTextContent('GB29 NWBK 6016');
    expect(within(tag).getByText('SWIFT').nextElementSibling).toHaveTextContent('NWBKGB2L');
  });
});

describe('a request for money, written on a slip while it is typed', () => {
  it('shows the amount typed, named, in the display face, and a dash for what is not typed yet', async () => {
    cashOut();
    const slip = screen.getByRole('region', { name: 'Request cash out' });
    expect(slip).toHaveTextContent('$0.00');
    expect(within(slip).getByText('Destination account').nextElementSibling).toHaveTextContent('—');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Amount'), '2500');
    await user.type(screen.getByLabelText('Destination account'), 'IL62 0108 0000 0009 9999 999');
    await user.type(screen.getByLabelText('Beneficiary name'), 'Red Ashwood');

    expect(slip.querySelector('.drawer-tag-amount')).toHaveTextContent('$2,500.00');
    expect(within(slip).getByText('Destination account').nextElementSibling).toHaveTextContent('IL62 0108 0000 0009 9999 999');
    expect(within(slip).getByText('Beneficiary name').nextElementSibling).toHaveTextContent('Red Ashwood');
  });

  it('says what the fee takes and what reaches the person once the server has quoted it', async () => {
    get.mockImplementation(async (path: string) => (path.startsWith('/finance/cash-out-quote') ? QUOTE : []));
    cashOut();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Amount'), '2500');
    const slip = screen.getByRole('region', { name: 'Request cash out' });
    await waitFor(() => expect(slip).toHaveTextContent('$30.00 comes off $2,500.00, so $2,470.00 reaches you.'));
    // The fee schedule is still a hint under the field; the slip is where the sum is.
    expect(screen.getByText(/Cash-out fee: 6% \(minimum \$0.99\) up to \$100.00/)).toBeInTheDocument();
  });

  it('is a cash-in slip, with the way the money comes in, when the request is for cash in', () => {
    render(
      <I18nProvider>
        <WalletRequestForm type="cash_in" availableMinor={0} existingRequests={[]} onSubmitted={() => {}} />
      </I18nProvider>,
    );
    const slip = screen.getByRole('region', { name: 'Request cash in' });
    expect(within(slip).getByText('Funding source').nextElementSibling).toHaveTextContent('Bank transfer');
  });
});
