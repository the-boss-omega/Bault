import { describe, it, expect } from 'vitest';
import { PayPalPaymentAdapter } from '@bault/adapters';

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
            { payments: { captures: [{ id: 'CAP1', amount: { value: '50.00', currency_code: 'USD' } }] } },
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
          { payments: { captures: [{ id: 'CAP2', amount: { value: '1.00', currency_code: 'USD' } }] } },
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
