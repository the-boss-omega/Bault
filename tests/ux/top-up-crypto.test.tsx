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
const { TopUpPanel, cryptoReturnFrom } = await import('../../apps/web/src/areas/customer/finance/MoneyPanels');

const PAYMENT = '0f6b1c2e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const HOSTED = 'https://commerce.coinbase.com/pay/ch_1';

const route = (key: string, checkout: string | null, instant: boolean, available = true) => ({
  key,
  label: key,
  instant,
  feeBps: 0,
  description: '',
  available,
  checkout,
  instructions: null,
});

const WITH_CRYPTO = {
  limits: { minMinor: 1_000, maxMinor: 2_000_000 },
  routes: [route('crypto', 'crypto', false), route('card', 'paypal', true), route('bank_transfer', null, false, false)],
  referenceNote: '',
};
const WITHOUT_CRYPTO = { ...WITH_CRYPTO, routes: WITH_CRYPTO.routes.filter((r) => r.key !== 'crypto') };

function renderPanel(props: Partial<Parameters<typeof TopUpPanel>[0]> = {}) {
  const onError = vi.fn();
  const onStatus = vi.fn();
  const onChanged = vi.fn();
  const onCryptoReturnHandled = vi.fn();
  render(
    <I18nProvider>
      <TopUpPanel onError={onError} onStatus={onStatus} onChanged={onChanged} onCryptoReturnHandled={onCryptoReturnHandled} {...props} />
    </I18nProvider>,
  );
  return { onError, onStatus, onChanged, onCryptoReturnHandled };
}

async function chooseCrypto(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('option', { name: /crypto \(coinbase commerce\)/i });
  await user.selectOptions(screen.getByRole('combobox'), 'crypto');
}

const catalogueOr = (catalogue: unknown, state?: unknown) => (path: string) =>
  Promise.resolve(path === '/finance/funding-routes' ? catalogue : state);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  leave.mockReset();
});

describe('cash-in by crypto', () => {
  it('offers no crypto option when the server does not list it', async () => {
    get.mockImplementation(catalogueOr(WITHOUT_CRYPTO));
    renderPanel();
    await screen.findByRole('combobox');
    expect(screen.queryByRole('option', { name: /crypto/i })).not.toBeInTheDocument();
  });

  it('says in plain words that the amount is in dollars, that Coinbase converts it, and when the credit arrives', async () => {
    const user = userEvent.setup();
    get.mockImplementation(catalogueOr(WITH_CRYPTO));
    renderPanel();
    await chooseCrypto(user);
    expect(await screen.findByRole('button', { name: /continue to coinbase/i })).toBeInTheDocument();
    expect(screen.getByText(/amount in dollars/i)).toBeInTheDocument();
    expect(screen.getByText(/converts the coins to dollars/i)).toBeInTheDocument();
    expect(screen.getByText(/once the network confirms/i)).toBeInTheDocument();
  });

  it('opens the charge on the server and sends the collector to Coinbase\'s page', async () => {
    const user = userEvent.setup();
    get.mockImplementation(catalogueOr(WITH_CRYPTO));
    post.mockResolvedValue({ paymentId: PAYMENT, chargeId: 'ch_1', hostedUrl: HOSTED, status: 'pending', amountMinor: 5_000, replayed: false });
    renderPanel();
    await chooseCrypto(user);

    const field = await screen.findByRole('textbox', { name: /amount/i });
    await user.type(field, '50');
    const button = screen.getByRole('button', { name: /continue to coinbase/i });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() => expect(leave).toHaveBeenCalledWith(HOSTED));
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/finance/checkout/crypto');
    expect(body).toMatchObject({ amountMinor: 5_000 });
    expect((body as { idempotencyKey: string }).idempotencyKey).toBeTruthy();
  });

  it('will not send the collector anywhere but Coinbase', async () => {
    const user = userEvent.setup();
    get.mockImplementation(catalogueOr(WITH_CRYPTO));
    post.mockResolvedValue({ paymentId: PAYMENT, hostedUrl: 'https://evil.example/pay', status: 'pending', amountMinor: 5_000 });
    const { onError } = renderPanel();
    await chooseCrypto(user);
    await user.type(await screen.findByRole('textbox', { name: /amount/i }), '50');
    await user.click(screen.getByRole('button', { name: /continue to coinbase/i }));
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/not been sent anywhere/i)));
    expect(leave).not.toHaveBeenCalled();
  });

  it('shows the payment pending when the collector comes back, and says when the wallet is credited', async () => {
    get.mockImplementation(catalogueOr(WITH_CRYPTO, { paymentId: PAYMENT, status: 'pending', amountMinor: 5_000, message: '' }));
    const { onStatus, onChanged, onCryptoReturnHandled } = renderPanel({ cryptoReturn: { outcome: 'returned', paymentId: PAYMENT } });

    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/waiting for the network.*\$50\.00.*nothing has been credited/i)));
    expect(get).toHaveBeenCalledWith(`/finance/checkout/crypto/${PAYMENT}`);
    expect(onCryptoReturnHandled).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();

    get.mockImplementation(catalogueOr(WITH_CRYPTO, { paymentId: PAYMENT, status: 'succeeded', amountMinor: 5_000, message: '' }));
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/\$50\.00 added to your balance/i)), { timeout: 8_000 });
    expect(onChanged).toHaveBeenCalled();
  }, 15_000);

  it('passes on what the server says when the charge failed', async () => {
    get.mockImplementation(
      catalogueOr(WITH_CRYPTO, { paymentId: PAYMENT, status: 'failed', amountMinor: 5_000, message: 'This crypto payment failed or expired before it was paid. Nothing has been credited.' }),
    );
    const { onError, onStatus } = renderPanel({ cryptoReturn: { outcome: 'returned', paymentId: PAYMENT } });
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/failed or expired/i)));
    expect(onStatus).toHaveBeenLastCalledWith(null);
  });

  it('records a charge the collector left at Coinbase, and says nothing was taken', async () => {
    get.mockImplementation(catalogueOr(WITH_CRYPTO));
    post.mockResolvedValue({ paymentId: PAYMENT, status: 'cancelled' });
    const { onStatus } = renderPanel({ cryptoReturn: { outcome: 'cancelled', paymentId: PAYMENT } });
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(expect.stringMatching(/nothing was taken/i)));
    expect(post.mock.calls[0]![0]).toBe(`/finance/checkout/crypto/${PAYMENT}/cancel`);
  });

  it('reads a return only for a real payment id and outcome', () => {
    expect(cryptoReturnFrom('returned', PAYMENT)).toEqual({ outcome: 'returned', paymentId: PAYMENT });
    expect(cryptoReturnFrom('approved', PAYMENT)).toBeNull();
    expect(cryptoReturnFrom('returned', 'not-an-id')).toBeNull();
  });
});
