import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Pressing Pay again after a top-up did not answer.
 *
 * The server dedupes a top-up on the idempotency key the panel sends, and that
 * only protects the collector if a retry of the SAME intended top-up carries the
 * SAME key. A network error says nothing about whether the card was charged,
 * so the second press must be answered with the first one's outcome, not
 * charge again. A different amount, a different route, or a top-up after one
 * that went through is a new top-up, with a new key.
 */

const get = vi.fn();
const post = vi.fn();

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

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { TopUpPanel } = await import('../../apps/web/src/areas/customer/finance/MoneyPanels');

const CATALOGUE = {
  limits: { minMinor: 500, maxMinor: 500_000 },
  routes: [
    { key: 'card', label: 'card', instant: true, feeBps: 0, description: '', available: true, instructions: null },
    { key: 'paypal_gs', label: 'paypal_gs', instant: true, feeBps: 0, description: '', available: true, instructions: null },
  ],
  referenceNote: '',
};

function renderPanel(onError = vi.fn(), onStatus = vi.fn()) {
  render(
    <I18nProvider>
      <TopUpPanel onError={onError} onStatus={onStatus} onChanged={() => {}} />
    </I18nProvider>,
  );
  return { onError, onStatus };
}

const keys = () => post.mock.calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey);
const unreachable = () => new MockApiError('unreachable', 0, 'The server could not be reached.');

async function setAmount(user: ReturnType<typeof userEvent.setup>, dollars: string) {
  const field = await screen.findByRole('textbox', { name: /amount/i });
  await user.clear(field);
  await user.type(field, dollars);
}

async function payNow(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole('button', { name: /pay now/i });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue(CATALOGUE);
});

describe('a retried top-up', () => {
  it('sends the same key again after a network error, so the server answers with the first attempt', async () => {
    const user = userEvent.setup();
    post.mockRejectedValueOnce(unreachable()).mockResolvedValueOnce({ status: 'succeeded', amountMinor: 5000, replayed: true });
    const { onStatus } = renderPanel();

    await setAmount(user, '50');
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    expect(keys()[0]).toBeTruthy();
    expect(keys()[1]).toBe(keys()[0]);
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('$50.00'));
  });

  it('keeps the key through a 5xx too: the provider may have taken the money', async () => {
    const user = userEvent.setup();
    post
      .mockRejectedValueOnce(new MockApiError('server', 502, 'The payment provider did not complete this payment.', 'provider_unavailable'))
      .mockResolvedValueOnce({ status: 'pending', amountMinor: 5000, replayed: true });
    renderPanel();

    await setAmount(user, '50');
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(keys()[1]).toBe(keys()[0]);
  });

  it('uses a new key for a new amount or a new route', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(unreachable());
    renderPanel();

    await setAmount(user, '50');
    await payNow(user);
    await setAmount(user, '60');
    await payNow(user);
    await user.selectOptions(screen.getByRole('combobox'), 'paypal_gs');
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));

    expect(new Set(keys()).size).toBe(3);
  });

  it('uses a new key for the next top-up once one has gone through', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ status: 'succeeded', amountMinor: 5000, replayed: false });
    renderPanel();

    await setAmount(user, '50');
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await setAmount(user, '50');
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    expect(keys()[1]).not.toBe(keys()[0]);
  });

  it('uses a new key after a refusal, which charged nothing', async () => {
    const user = userEvent.setup();
    post
      .mockRejectedValueOnce(new MockApiError('client', 409, 'The payment was declined. Nothing has been charged.', 'conflict'))
      .mockResolvedValueOnce({ status: 'succeeded', amountMinor: 5000, replayed: false });
    renderPanel();

    await setAmount(user, '50');
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(keys()[1]).not.toBe(keys()[0]);
  });

  it('says the payment did not go through when the retry is answered with a refusal', async () => {
    const user = userEvent.setup();
    post.mockRejectedValueOnce(unreachable()).mockResolvedValueOnce({ status: 'failed', amountMinor: 5000, replayed: true });
    const { onError, onStatus } = renderPanel();

    await setAmount(user, '50');
    await payNow(user);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await payNow(user);
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/did not go through/i)));
    expect(onStatus).not.toHaveBeenCalledWith(expect.stringContaining('$50.00'));
  });
});
