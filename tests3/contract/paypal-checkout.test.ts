import { describe, it, expect } from 'vitest';
import {
  PayPalPaymentAdapter,
  PaymentProviderError,
  SANDBOX_CHECKOUT_CENTS,
  SandboxPaymentAdapter,
  checkoutCaptureFromEvent,
  type CheckoutOrderRequest,
} from '@bault/adapters';

type Call = { url: string; init: RequestInit };
type Reply = { status?: number; body: unknown };

const AUTH = { access_token: 'tok', expires_in: 3600 };

function paypal(routes: Record<string, Reply | Reply[]>, calls: Call[] = [], environment: 'sandbox' | 'live' = 'sandbox') {
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init: init ?? {} });
    if (href.includes('/v1/oauth2/token')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(AUTH), json: async () => AUTH };
    }
    const key = [...queues.keys()].filter((k) => href.includes(k)).sort((a, b) => b.length - a.length)[0];
    const queue = key ? queues.get(key)! : [];
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
    if (!reply) return { ok: false, status: 404, text: async () => 'no stub', json: async () => ({}) };
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(reply.body),
      json: async () => reply.body,
    };
  }) as unknown as typeof fetch;
  return new PayPalPaymentAdapter({ clientId: 'id', clientSecret: 'secret', environment, webhookId: 'wh_1', fetchImpl: impl });
}

const ORDER_REQUEST: CheckoutOrderRequest = {
  amountMinor: 5_000,
  currency: 'USD',
  requestId: 'cash-in-order:PAY-1',
  customId: 'PAY-1',
  description: 'Bault wallet cash-in',
  returnUrl: 'https://app.example.com/?paypal=approved&payment=PAY-1',
  cancelUrl: 'https://app.example.com/?paypal=cancelled&payment=PAY-1',
  landing: 'card',
};

const created = (orderId: string, href = `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`) => ({
  body: {
    id: orderId,
    status: 'PAYER_ACTION_REQUIRED',
    links: [
      { href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}`, rel: 'self', method: 'GET' },
      { href, rel: 'payer-action', method: 'GET' },
    ],
  },
});

const completedOrder = (captureStatus: string, extra: Record<string, unknown> = {}) => ({
  body: {
    id: 'ORDER-1',
    status: 'COMPLETED',
    purchase_units: [
      {
        reference_id: 'PAY-1',
        payments: {
          captures: [
            {
              id: 'CAP-1',
              status: captureStatus,
              amount: { currency_code: 'USD', value: '50.00' },
              custom_id: 'PAY-1',
              seller_receivable_breakdown: {
                gross_amount: { currency_code: 'USD', value: '50.00' },
                paypal_fee: { currency_code: 'USD', value: '2.24' },
                net_amount: { currency_code: 'USD', value: '47.76' },
              },
              ...extra,
            },
          ],
        },
      },
    ],
  },
});

const problem = (status: number, issue: string) => ({
  status,
  body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue, description: issue.toLowerCase() }], message: 'refused' },
});

describe('a PayPal checkout order is created for the amount Bault chose', () => {
  it('asks for a capture of exactly that amount, tied to the payment row, and returns where to send the payer', async () => {
    const calls: Call[] = [];
    const a = paypal({ '/v2/checkout/orders': created('ORDER-1') }, calls);

    const order = await a.createCheckoutOrder(ORDER_REQUEST);
    expect(order).toEqual({ orderId: 'ORDER-1', approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1' });

    const sent = calls.find((c) => c.url.endsWith('/v2/checkout/orders'))!;
    expect(sent.init.method).toBe('POST');
    expect((sent.init.headers as Record<string, string>)['PayPal-Request-Id']).toBe('cash-in-order:PAY-1');
    const body = JSON.parse(sent.init.body as string);
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units).toHaveLength(1);
    expect(body.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '50.00' });
    expect(body.purchase_units[0].custom_id).toBe('PAY-1');
    const experience = body.payment_source.paypal.experience_context;
    expect(experience.return_url).toBe(ORDER_REQUEST.returnUrl);
    expect(experience.cancel_url).toBe(ORDER_REQUEST.cancelUrl);
    expect(experience.shipping_preference).toBe('NO_SHIPPING');
    expect(experience.user_action).toBe('PAY_NOW');
    expect(experience.payment_method_preference).toBe('IMMEDIATE_PAYMENT_REQUIRED');
  });

  it('opens on the card form for the card route, and on the PayPal sign-in otherwise', async () => {
    const landing = async (route: 'card' | 'paypal') => {
      const calls: Call[] = [];
      await paypal({ '/v2/checkout/orders': created('ORDER-2') }, calls).createCheckoutOrder({ ...ORDER_REQUEST, landing: route });
      return JSON.parse(calls.find((c) => c.url.endsWith('/v2/checkout/orders'))!.init.body as string).payment_source.paypal
        .experience_context.landing_page;
    };
    expect(await landing('card')).toBe('GUEST_CHECKOUT');
    expect(await landing('paypal')).toBe('LOGIN');
  });

  it('accepts the older "approve" link as well as "payer-action"', async () => {
    const a = paypal({
      '/v2/checkout/orders': {
        body: { id: 'ORDER-3', status: 'CREATED', links: [{ href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-3', rel: 'approve' }] },
      },
    });
    expect((await a.createCheckoutOrder(ORDER_REQUEST)).approveUrl).toContain('token=ORDER-3');
  });

  it('will not send the payer anywhere but PayPal, or to the other environment', async () => {
    const elsewhere = paypal({ '/v2/checkout/orders': created('ORDER-4', 'https://paypa1.example.com/checkoutnow?token=ORDER-4') });
    await expect(elsewhere.createCheckoutOrder(ORDER_REQUEST)).rejects.toBeInstanceOf(PaymentProviderError);

    const plain = paypal({ '/v2/checkout/orders': created('ORDER-5', 'http://www.sandbox.paypal.com/checkoutnow?token=ORDER-5') });
    await expect(plain.createCheckoutOrder(ORDER_REQUEST)).rejects.toBeInstanceOf(PaymentProviderError);

    const crossed = paypal({ '/v2/checkout/orders': created('ORDER-6') }, [], 'live');
    await expect(crossed.createCheckoutOrder(ORDER_REQUEST)).rejects.toBeInstanceOf(PaymentProviderError);

    const live = paypal({ '/v2/checkout/orders': created('ORDER-7', 'https://www.paypal.com/checkoutnow?token=ORDER-7') }, [], 'live');
    expect((await live.createCheckoutOrder(ORDER_REQUEST)).approveUrl).toBe('https://www.paypal.com/checkoutnow?token=ORDER-7');
  });

  it('refuses an amount that is not a whole positive number of cents', async () => {
    const a = paypal({ '/v2/checkout/orders': created('ORDER-8') });
    await expect(a.createCheckoutOrder({ ...ORDER_REQUEST, amountMinor: 0 })).rejects.toThrow(/amount/i);
    await expect(a.createCheckoutOrder({ ...ORDER_REQUEST, amountMinor: 12.5 })).rejects.toThrow(/amount/i);
  });
});

describe('capturing a checkout order', () => {
  it('captures under its own request id and reports the capture, the amount and PayPal\'s fee', async () => {
    const calls: Call[] = [];
    const a = paypal({ '/v2/checkout/orders/ORDER-1/capture': completedOrder('COMPLETED') }, calls);

    const capture = await a.captureCheckoutOrder('ORDER-1', { requestId: 'cash-in-capture:PAY-1' });
    expect(capture).toEqual({
      orderId: 'ORDER-1',
      status: 'succeeded',
      captureId: 'CAP-1',
      amountMinor: 5_000,
      currency: 'USD',
      feeMinor: 224,
      feeCurrency: 'USD',
      customId: 'PAY-1',
      detail: null,
    });

    const sent = calls.find((c) => c.url.includes('/capture'))!;
    const headers = sent.init.headers as Record<string, string>;
    expect(headers['PayPal-Request-Id']).toBe('cash-in-capture:PAY-1');
    expect(headers.Prefer).toBe('return=representation');
  });

  it('reports a capture PayPal is holding as pending, with its reason', async () => {
    const a = paypal({
      '/capture': completedOrder('PENDING', { status_details: { reason: 'PENDING_REVIEW' }, seller_receivable_breakdown: undefined }),
    });
    const capture = await a.captureCheckoutOrder('ORDER-1', { requestId: 'r' });
    expect(capture.status).toBe('pending');
    expect(capture.captureId).toBe('CAP-1');
    expect(capture.detail).toBe('PENDING_REVIEW');
    expect(capture.feeMinor).toBeNull();
  });

  it('reports a declined or failed capture as failed', async () => {
    for (const status of ['DECLINED', 'FAILED']) {
      const a = paypal({ '/capture': completedOrder(status) });
      expect((await a.captureCheckoutOrder('ORDER-1', { requestId: 'r' })).status, status).toBe('failed');
    }
  });

  it('reads the order back when it was already captured, instead of failing', async () => {
    const calls: Call[] = [];
    const a = paypal(
      {
        '/v2/checkout/orders/ORDER-1/capture': problem(422, 'ORDER_ALREADY_CAPTURED'),
        '/v2/checkout/orders/ORDER-1': completedOrder('COMPLETED'),
      },
      calls,
    );
    const capture = await a.captureCheckoutOrder('ORDER-1', { requestId: 'r' });
    expect(capture.status).toBe('succeeded');
    expect(capture.captureId).toBe('CAP-1');
    expect(calls.some((c) => c.url.endsWith('/v2/checkout/orders/ORDER-1') && c.init.method === 'GET')).toBe(true);
  });

  it('names PayPal\'s reason when it refuses the capture, apart from not answering', async () => {
    const declined = paypal({ '/capture': problem(422, 'INSTRUMENT_DECLINED') });
    const err = await declined.captureCheckoutOrder('ORDER-1', { requestId: 'r' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect(err).toMatchObject({ refused: true, issue: 'INSTRUMENT_DECLINED', status: 422 });

    const notApproved = paypal({ '/capture': problem(422, 'ORDER_NOT_APPROVED') });
    await expect(notApproved.captureCheckoutOrder('ORDER-1', { requestId: 'r' })).rejects.toMatchObject({ issue: 'ORDER_NOT_APPROVED' });

    const down = paypal({ '/capture': { status: 503, body: { name: 'SERVICE_UNAVAILABLE' } } });
    await expect(down.captureCheckoutOrder('ORDER-1', { requestId: 'r' })).rejects.toMatchObject({ refused: false });
  });

  it('reports an order the payer has not approved, with no capture, as pending', async () => {
    const a = paypal({ '/v2/checkout/orders/ORDER-9': { body: { id: 'ORDER-9', status: 'PAYER_ACTION_REQUIRED', purchase_units: [{}] } } });
    const order = await a.getCheckoutOrder('ORDER-9');
    expect(order.status).toBe('pending');
    expect(order.captureId).toBeNull();
  });

  it('reports a voided order as failed, and a capture already refunded as reversed', async () => {
    const voided = paypal({ '/v2/checkout/orders/ORDER-9': { body: { id: 'ORDER-9', status: 'VOIDED', purchase_units: [{}] } } });
    expect((await voided.getCheckoutOrder('ORDER-9')).status).toBe('failed');
    const refunded = paypal({ '/v2/checkout/orders/ORDER-1': completedOrder('REFUNDED') });
    expect((await refunded.getCheckoutOrder('ORDER-1')).status).toBe('reversed');
  });
});

describe('a capture webhook says what became of which order', () => {
  const resource = {
    id: 'CAP-1',
    status: 'COMPLETED',
    amount: { currency_code: 'USD', value: '50.00' },
    custom_id: 'PAY-1',
    seller_receivable_breakdown: { paypal_fee: { currency_code: 'USD', value: '2.24' } },
    supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
  };

  it('reads a completed capture', () => {
    expect(checkoutCaptureFromEvent({ id: 'WH-1', type: 'PAYMENT.CAPTURE.COMPLETED', data: resource })).toEqual({
      kind: 'capture',
      capture: {
        orderId: 'ORDER-1',
        status: 'succeeded',
        captureId: 'CAP-1',
        amountMinor: 5_000,
        currency: 'USD',
        feeMinor: 224,
        feeCurrency: 'USD',
        customId: 'PAY-1',
        detail: null,
      },
    });
  });

  it('takes the outcome from the event type, not from anything else in the body', () => {
    const outcome = (type: string) => {
      const read = checkoutCaptureFromEvent({ id: 'WH-2', type, data: { ...resource, status: 'COMPLETED' } });
      return read?.kind === 'capture' ? read.capture.status : read?.kind ?? null;
    };
    expect(outcome('PAYMENT.CAPTURE.PENDING')).toBe('pending');
    expect(outcome('PAYMENT.CAPTURE.DENIED')).toBe('failed');
    expect(outcome('PAYMENT.CAPTURE.DECLINED')).toBe('failed');
    expect(outcome('PAYMENT.CAPTURE.REVERSED')).toBe('reversed');
    expect(outcome('PAYMENT.CAPTURE.REFUNDED')).toBe('reversed');
    expect(outcome('PAYMENT.PAYOUTS-ITEM.SUCCEEDED')).toBeNull();
    expect(outcome('CHECKOUT.ORDER.COMPLETED')).toBeNull();
  });

  it('reads an approved order as a request to capture it', () => {
    expect(
      checkoutCaptureFromEvent({
        id: 'WH-3',
        type: 'CHECKOUT.ORDER.APPROVED',
        data: { id: 'ORDER-1', status: 'APPROVED', purchase_units: [{ custom_id: 'PAY-1' }] },
      }),
    ).toEqual({ kind: 'approved', orderId: 'ORDER-1', customId: 'PAY-1' });
  });

  it('reads nothing from a capture event that names no order, no payment and no capture', () => {
    expect(checkoutCaptureFromEvent({ id: 'WH-4', type: 'PAYMENT.CAPTURE.COMPLETED', data: { status: 'COMPLETED' } })).toBeNull();
  });

  it('names the capture a refund undid by its "up" link, not by the refund\'s own id', () => {
    const read = checkoutCaptureFromEvent({
      id: 'WH-5',
      type: 'PAYMENT.CAPTURE.REFUNDED',
      data: {
        id: 'REFUND-1',
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: '50.00' },
        links: [{ rel: 'up', href: 'https://api-m.paypal.com/v2/payments/captures/CAP-1' }],
      },
    });
    expect(read).toMatchObject({ kind: 'capture', capture: { status: 'reversed', captureId: 'CAP-1', orderId: null } });
  });
});

describe('the sandbox stands in for PayPal checkout, and is just as strict about amounts', () => {
  it('approves at once by sending the payer straight back, and captures what was ordered', async () => {
    const sandbox = new SandboxPaymentAdapter();
    const order = await sandbox.createCheckoutOrder(ORDER_REQUEST);
    expect(order.approveUrl.startsWith(`${ORDER_REQUEST.returnUrl}&token=`)).toBe(true);
    expect(order.approveUrl).toContain(encodeURIComponent(order.orderId));

    const again = await sandbox.createCheckoutOrder(ORDER_REQUEST);
    expect(again.orderId).toBe(order.orderId);

    const capture = await sandbox.captureCheckoutOrder(order.orderId, { requestId: 'r' });
    expect(capture).toMatchObject({ orderId: order.orderId, status: 'succeeded', amountMinor: 5_000, currency: 'USD', customId: 'PAY-1' });
    expect(capture.captureId).toBeTruthy();
    expect(capture.feeMinor).toBeGreaterThan(0);
    expect(await sandbox.getCheckoutOrder(order.orderId)).toEqual(capture);
  });

  it('declines, holds, short-pays or refuses for the set cents, and loses one answer for another', async () => {
    const sandbox = new SandboxPaymentAdapter();
    const take = async (cents: number) => {
      const order = await sandbox.createCheckoutOrder({ ...ORDER_REQUEST, amountMinor: 5_000 + cents });
      return sandbox.captureCheckoutOrder(order.orderId, { requestId: 'r' });
    };
    expect((await take(SANDBOX_CHECKOUT_CENTS.declined)).status).toBe('failed');
    expect((await take(SANDBOX_CHECKOUT_CENTS.pending)).status).toBe('pending');
    expect((await take(SANDBOX_CHECKOUT_CENTS.short)).amountMinor).toBe(5_000 + SANDBOX_CHECKOUT_CENTS.short - 100);
    await expect(take(SANDBOX_CHECKOUT_CENTS.notApproved)).rejects.toMatchObject({ refused: true, issue: 'ORDER_NOT_APPROVED' });
    await expect(take(SANDBOX_CHECKOUT_CENTS.lost)).rejects.toMatchObject({ refused: false });
    expect((await take(SANDBOX_CHECKOUT_CENTS.lost)).status).toBe('succeeded');
  });

  it('refuses to capture an order it never created', async () => {
    await expect(new SandboxPaymentAdapter().captureCheckoutOrder('ORDER-FORGED', { requestId: 'r' })).rejects.toBeInstanceOf(
      PaymentProviderError,
    );
  });
});
