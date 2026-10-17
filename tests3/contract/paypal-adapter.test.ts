import { describe, it, expect } from 'vitest';
import { PayPalPaymentAdapter, PaymentProviderError } from '@bault/adapters';

/**
 * The PayPal adapter — the rail the reference service actually uses.
 *
 * Driven against a stub `fetch` rather than the network, so these run anywhere
 * with no credentials. What is under test is the part that carries the risk:
 * that a top-up is a CAPTURE of an order somebody approved, that the adapter
 * reports what the provider says it settled, and that a webhook is refused
 * unless PayPal itself vouches for it.
 */

type Call = { url: string; init: RequestInit };

/** A fetch stub that answers by URL and records what it was asked. */
function stubFetch(routes: Record<string, unknown>, calls: Call[] = []) {
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init: init ?? {} });
    const key = Object.keys(routes).find((k) => href.includes(k));
    if (!key) return { ok: false, status: 404, text: async () => 'no stub', json: async () => ({}) };
    const body = routes[key];
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const AUTH = { access_token: 'tok', expires_in: 3600 };

function adapter(routes: Record<string, unknown>, calls: Call[] = []) {
  const { impl } = stubFetch({ '/v1/oauth2/token': AUTH, ...routes }, calls);
  return new PayPalPaymentAdapter({
    clientId: 'id',
    clientSecret: 'secret',
    environment: 'sandbox',
    webhookId: 'wh_1',
    fetchImpl: impl,
  });
}

describe('configuration', () => {
  it('refuses to construct without credentials', () => {
    expect(
      () =>
        new PayPalPaymentAdapter({
          clientId: '',
          clientSecret: '',
          environment: 'sandbox',
          webhookId: 'wh',
        }),
    ).toThrow(/PAYPAL_CLIENT_ID/);
  });

  it('refuses to construct without a webhook id', () => {
    // Without it nothing can be verified, and an unverified webhook that credits
    // a ledger is an open mint. Better to fail at boot than at 3am.
    expect(
      () =>
        new PayPalPaymentAdapter({
          clientId: 'id',
          clientSecret: 'secret',
          environment: 'sandbox',
          webhookId: '',
        }),
    ).toThrow(/WEBHOOK_ID/);
  });

  it('says out loud whether it is moving real money', () => {
    const test = new PayPalPaymentAdapter({
      clientId: 'i', clientSecret: 's', environment: 'sandbox', webhookId: 'w',
    });
    const live = new PayPalPaymentAdapter({
      clientId: 'i', clientSecret: 's', environment: 'live', webhookId: 'w',
    });
    expect(test.handlesRealMoney).toBe(false);
    expect(live.handlesRealMoney).toBe(true);
    expect(test.providerName).toBe('paypal:sandbox');
  });
});

describe('a top-up is a capture, never a charge', () => {
  it('refuses to take money with no approved order', async () => {
    const a = adapter({});
    await expect(
      a.createTopup({ userId: 'u', amountMinor: 500_000, currency: 'USD', idempotencyKey: 'k' }),
    ).rejects.toThrow(/order/i);
  });

  it('captures the order the payer approved and reports what settled', async () => {
    const calls: Call[] = [];
    const a = adapter(
      {
        '/capture': {
          id: 'ORDER1',
          status: 'COMPLETED',
          purchase_units: [
            // The capture's own status is what says the money was taken.
            {
              payments: {
                captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '50.00', currency_code: 'USD' } }],
              },
            },
          ],
        },
      },
      calls,
    );

    const result = await a.createTopup({
      userId: 'u',
      amountMinor: 5_000,
      currency: 'USD',
      idempotencyKey: 'key-1',
      paymentMethodToken: 'ORDER1',
    });

    expect(result.status).toBe('succeeded');
    expect(result.providerRef).toBe('CAP1');
    // The figure the CALLER must check against what it asked for.
    expect(result.settledAmountMinor).toBe(5_000);
    expect(result.settledCurrency).toBe('USD');

    const capture = calls.find((c) => c.url.includes('/capture'))!;
    expect(capture.url).toContain('/v2/checkout/orders/ORDER1/capture');
    // Idempotency travels to PayPal, so a retry converges on one movement.
    expect((capture.init.headers as Record<string, string>)['PayPal-Request-Id']).toBe('key-1');
  });

  it('reports the real figure when it differs from what was asked', async () => {
    // The attack this defends: approve $1, ask to be credited $5,000. Capture
    // legitimately succeeds — a real order really was approved — and only the
    // settled amount tells the truth.
    const a = adapter({
      '/capture': {
        id: 'ORDER2',
        status: 'COMPLETED',
        purchase_units: [
          {
            payments: {
              captures: [{ id: 'CAP2', status: 'COMPLETED', amount: { value: '1.00', currency_code: 'USD' } }],
            },
          },
        ],
      },
    });

    const result = await a.createTopup({
      userId: 'u',
      amountMinor: 500_000,
      currency: 'USD',
      idempotencyKey: 'key-2',
      paymentMethodToken: 'ORDER2',
    });
    expect(result.settledAmountMinor).toBe(100);
    expect(result.settledAmountMinor).not.toBe(500_000);
  });

  it('does not claim success for an order PayPal has not completed', async () => {
    const a = adapter({ '/capture': { id: 'ORDER3', status: 'PENDING', purchase_units: [] } });
    const result = await a.createTopup({
      userId: 'u', amountMinor: 100, currency: 'USD', idempotencyKey: 'k3', paymentMethodToken: 'ORDER3',
    });
    expect(result.status).toBe('pending');
  });
});

describe('a capture succeeds when the CAPTURE completed, not the order (F028)', () => {
  /**
   * PayPal can mark an order COMPLETED while the capture inside it is still
   * PENDING (an eCheck, a payment held for review). Reading the order's status
   * would credit the wallet for money that has not arrived and might never.
   */
  const order = (orderStatus: string, captureStatus: string) => ({
    '/capture': {
      id: 'ORDER9',
      status: orderStatus,
      purchase_units: [
        {
          payments: {
            captures: [{ id: 'CAP9', status: captureStatus, amount: { value: '20.00', currency_code: 'USD' } }],
          },
        },
      ],
    },
  });
  const take = (a: PayPalPaymentAdapter) =>
    a.createTopup({ userId: 'u', amountMinor: 2_000, currency: 'USD', idempotencyKey: 'k9', paymentMethodToken: 'ORDER9' });

  it('reports pending for a completed order whose capture is pending', async () => {
    const result = await take(adapter(order('COMPLETED', 'PENDING')));
    expect(result.status).toBe('pending');
    expect(result.providerRef).toBe('CAP9');
  });

  it('reports succeeded only when the capture itself completed', async () => {
    expect((await take(adapter(order('COMPLETED', 'COMPLETED')))).status).toBe('succeeded');
  });

  it('reports failed for a declined capture', async () => {
    expect((await take(adapter(order('COMPLETED', 'DECLINED')))).status).toBe('failed');
  });

  it('reports pending when there is no capture at all', async () => {
    const result = await take(adapter({ '/capture': { id: 'ORDER9', status: 'COMPLETED', purchase_units: [] } }));
    expect(result.status).toBe('pending');
  });
});

describe('a cash-out is a payout to an email', () => {
  it('sends the batch and reports acceptance as pending, not settled', async () => {
    const calls: Call[] = [];
    const a = adapter(
      { '/payouts': { batch_header: { payout_batch_id: 'BATCH1', batch_status: 'PENDING' } } },
      calls,
    );

    const result = await a.createPayout({
      userId: 'u',
      amountMinor: 2_500,
      currency: 'USD',
      idempotencyKey: 'payout-1',
      destinationToken: 'collector@example.com',
    });

    // Accepted ≠ landed. Claiming 'succeeded' here would tell a collector their
    // money had arrived before PayPal had moved it.
    expect(result.status).toBe('pending');
    expect(result.providerRef).toBe('BATCH1');

    const sent = JSON.parse(calls.find((c) => c.url.includes('/payouts'))!.init.body as string);
    expect(sent.items[0].receiver).toBe('collector@example.com');
    expect(sent.items[0].amount).toEqual({ value: '25.00', currency: 'USD' });
  });

  it('refuses a payout with no destination', async () => {
    const a = adapter({});
    await expect(
      a.createPayout({
        userId: 'u', amountMinor: 100, currency: 'USD', idempotencyKey: 'k', destinationToken: '  ',
      }),
    ).rejects.toThrow(/destination/i);
  });

  it('gives up when told to, instead of holding the caller for as long as PayPal hangs (N6)', async () => {
    // A fetch that answers the token and then never answers the payout — unless
    // the signal it was handed is aborted.
    const hanging = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/oauth2/token')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(AUTH), json: async () => AUTH };
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    const a = new PayPalPaymentAdapter({
      clientId: 'id', clientSecret: 'secret', environment: 'sandbox', webhookId: 'wh', fetchImpl: hanging,
    });
    const started = Date.now();
    await expect(
      a.createPayout({
        userId: 'u', amountMinor: 100, currency: 'USD', idempotencyKey: 'k-hang',
        destinationToken: 'c@example.com', signal: AbortSignal.timeout(50),
      }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('says when PayPal refused the payout outright, as opposed to not answering', async () => {
    const refusing = (async (url: string | URL) => {
      if (String(url).includes('/oauth2/token')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(AUTH), json: async () => AUTH };
      }
      const body = JSON.stringify({ name: 'VALIDATION_ERROR', message: 'Invalid request' });
      return { ok: false, status: 422, text: async () => body, json: async () => JSON.parse(body) };
    }) as unknown as typeof fetch;
    const a = new PayPalPaymentAdapter({
      clientId: 'id', clientSecret: 'secret', environment: 'sandbox', webhookId: 'wh', fetchImpl: refusing,
    });
    const err = await a
      .createPayout({ userId: 'u', amountMinor: 100, currency: 'USD', idempotencyKey: 'k-422', destinationToken: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as PaymentProviderError).refused).toBe(true);
  });

  it('reads back what became of a payout from its batch', async () => {
    const calls: Call[] = [];
    const a = adapter(
      {
        '/v1/payments/payouts/BATCH7': {
          batch_header: { payout_batch_id: 'BATCH7', batch_status: 'SUCCESS' },
          items: [{ transaction_status: 'RETURNED' }],
        },
      },
      calls,
    );
    // The batch was processed; the ITEM came back. The item is what says
    // whether the collector got the money.
    const result = await a.getPayout('BATCH7');
    expect(result.status).toBe('failed');
    expect(calls.some((c) => c.url.endsWith('/v1/payments/payouts/BATCH7'))).toBe(true);
  });
});

describe('webhooks are authenticated by asking PayPal', () => {
  const HEADERS = {
    'paypal-transmission-id': 't-id',
    'paypal-transmission-time': 't-time',
    'paypal-cert-url': 'https://api.paypal.com/cert',
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-transmission-sig': 'sig',
  };
  const BODY = JSON.stringify({
    id: 'WH-EVT-1',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { amount: { value: '10.00' } },
  });

  it('returns the event when PayPal verifies it', async () => {
    const calls: Call[] = [];
    const a = adapter({ '/verify-webhook-signature': { verification_status: 'SUCCESS' } }, calls);

    const event = await a.verifyWebhook({ rawBody: BODY, headers: HEADERS });
    expect(event.id).toBe('WH-EVT-1');
    expect(event.type).toBe('PAYMENT.CAPTURE.COMPLETED');

    // The webhook id is what binds the signature to THIS endpoint.
    const sent = JSON.parse(
      calls.find((c) => c.url.includes('/verify-webhook-signature'))!.init.body as string,
    );
    expect(sent.webhook_id).toBe('wh_1');
    expect(sent.transmission_sig).toBe('sig');
  });

  it('throws when PayPal does not verify it', async () => {
    const a = adapter({ '/verify-webhook-signature': { verification_status: 'FAILURE' } });
    await expect(a.verifyWebhook({ rawBody: BODY, headers: HEADERS })).rejects.toThrow(/did not verify/i);
  });

  it('refuses a delivery with a missing header rather than skipping the check', async () => {
    // "No signature" is the one case an attacker controls completely, so it must
    // be a failure and never a shortcut.
    const a = adapter({ '/verify-webhook-signature': { verification_status: 'SUCCESS' } });
    for (const drop of Object.keys(HEADERS)) {
      const headers = { ...HEADERS } as Record<string, string | undefined>;
      delete headers[drop];
      await expect(
        a.verifyWebhook({ rawBody: BODY, headers }),
        `missing ${drop} was accepted`,
      ).rejects.toThrow(/missing/i);
    }
  });

  it('refuses a body that is not JSON', async () => {
    const a = adapter({ '/verify-webhook-signature': { verification_status: 'SUCCESS' } });
    await expect(a.verifyWebhook({ rawBody: 'not json', headers: HEADERS })).rejects.toThrow(/JSON/i);
  });
});
