import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
const leave = vi.fn();

class MockApiError extends Error {
  constructor(
    readonly kind: string,
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), del: vi.fn() },
  ApiError: MockApiError,
}));

vi.mock('../../apps/web/src/shared/paypalCheckout', async (original) => ({
  ...(await original<typeof import('../../apps/web/src/shared/paypalCheckout')>()),
  leaveForPayPal: (href: string) => leave(href),
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { TopUpPanel } = await import('../../apps/web/src/areas/customer/finance/MoneyPanels');

const PAYMENT = '0f6b1c2e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const APPROVE = 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1';

const route = (key: string, checkout: string | null, available = true) => ({
  key,
  label: key,
  instant: checkout !== null,
  feeBps: 0,
  description: '',
  available,
  checkout,
  instructions: null,
});

const CATALOGUE = {
  limits: { minMinor: 1_000, maxMinor: 2_000_000 },
  routes: [route('card', 'paypal'), route('paypal_gs', 'paypal'), route('bank_transfer', null, false)],
  referenceNote: '',
};

function renderPanel(props: Partial<Parameters<typeof TopUpPanel>[0]> = {}) {
  const onError = vi.fn();
  const onStatus = vi.fn();
  const onChanged = vi.fn();
  const onPayPalReturnHandled = vi.fn();
  render(
    <I18nProvider>
      <TopUpPanel
        onError={onError}
        onStatus={onStatus}
        onChanged={onChanged}
        onPayPalReturnHandled={onPayPalReturnHandled}
        {...props}
      />
    </I18nProvider>,
  );
  return { onError, onStatus, onChanged, onPayPalReturnHandled };
}

async function typeAmount(user: ReturnType<typeof userEvent.setup>, dollars: string) {
  const field = await screen.findByRole('textbox', { name: /amount/i });
  await user.clear(field);
  await user.type(field, dollars);
}

async function continueToPayPal(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: /continue to paypal/i });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  leave.mockReset();
  get.mockResolvedValue(CATALOGUE);
});

describe('cash-in by PayPal checkout', () => {
  it('says the payment is made on PayPal\'s page, and offers no "Pay now"', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: /continue to paypal/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pay now/i })).not.toBeInTheDocument();
    expect(screen.getByText(/debit or credit card on PayPal/i)).toBeInTheDocument();
  });

  it('opens the order on the server and sends the collector to PayPal to approve it', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ paymentId: PAYMENT, orderId: 'ORDER-1', approveUrl: APPROVE, status: 'pending', amountMinor: 5_000, replayed: false });
    renderPanel();

    await typeAmount(user, '50');
    await continueToPayPal(user);

    await waitFor(() => expect(leave).toHaveBeenCalledWith(APPROVE));
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/finance/checkout/paypal');
    expect(body).toMatchObject({ amountMinor: 5_000, route: 'card' });
    expect((body as { idempotencyKey: string }).idempotencyKey).toBeTruthy();
  });

  it('sends the same key again after a network error, so the server gives back the same order', async () => {
    const user = userEvent.setup();
    post
      .mockRejectedValueOnce(new MockApiError('unreachable', 0, 'The server could not be reached.'))
      .mockResolvedValueOnce({ paymentId: PAYMENT, orderId: 'ORDER-1', approveUrl: APPROVE, status: 'pending', amountMinor: 5_000, replayed: true });
    renderPanel();

    await typeAmount(user, '50');
    await continueToPayPal(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await continueToPayPal(user);
    await waitFor(() => expect(leave).toHaveBeenCalledWith(APPROVE));
    const keys = post.mock.calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
  });

  it('will not send the collector anywhere but PayPal', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      paymentId: PAYMENT,
      orderId: 'ORDER-1',
      approveUrl: 'https://evil.example/checkoutnow?token=ORDER-1',
      status: 'pending',
      amountMinor: 5_000,
      replayed: false,
    });
    const { onError } = renderPanel();

    await typeAmount(user, '50');
    await continueToPayPal(user);
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/not been sent anywhere/i)));
    expect(leave).not.toHaveBeenCalled();
  });

  it('finishes the payment when the collector comes back from PayPal, and says what landed', async () => {
    post.mockResolvedValue({ paymentId: PAYMENT, status: 'succeeded', amountMinor: 5_000, replayed: false, message: '' });
    const { onStatus, onChanged, onPayPalReturnHandled } = renderPanel({ paypalReturn: { outcome: 'approved', paymentId: PAYMENT } });

    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.stringContaining('$50.00')));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toBe(`/finance/checkout/paypal/${PAYMENT}/capture`);
    expect(onChanged).toHaveBeenCalled();
    expect(onPayPalReturnHandled).toHaveBeenCalledTimes(1);
  });

  it('says plainly when PayPal is holding the payment, and that nothing is credited yet', async () => {
    post.mockResolvedValue({ paymentId: PAYMENT, status: 'pending', amountMinor: 5_000, replayed: false, message: '' });
    const { onStatus } = renderPanel({ paypalReturn: { outcome: 'approved', paymentId: PAYMENT } });
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/holding.*nothing has been credited/i)));
  });

  it('passes on what the server says when PayPal declined', async () => {
    post.mockRejectedValue(
      new MockApiError('client', 409, 'PayPal declined this payment. Nothing was taken and nothing has been credited.', 'conflict'),
    );
    const { onError, onStatus, onPayPalReturnHandled } = renderPanel({ paypalReturn: { outcome: 'approved', paymentId: PAYMENT } });
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/declined/i)));
    expect(onStatus).toHaveBeenLastCalledWith(null);
    expect(onPayPalReturnHandled).toHaveBeenCalledTimes(1);
  });

  it('records a checkout the collector left at PayPal, and says nothing was taken', async () => {
    post.mockResolvedValue({ paymentId: PAYMENT, status: 'cancelled' });
    const { onStatus } = renderPanel({ paypalReturn: { outcome: 'cancelled', paymentId: PAYMENT } });
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/nothing was taken/i)));
    expect(post.mock.calls[0]![0]).toBe(`/finance/checkout/paypal/${PAYMENT}/cancel`);
  });
});
