export interface ChargeRequest {
  userId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  paymentMethodToken?: string;
  signal?: AbortSignal;
}

export class PaymentProviderError extends Error {
  readonly status: number | null;
  readonly refused: boolean;

  constructor(message: string, options: { status?: number | null; refused?: boolean } = {}) {
    super(message);
    this.name = 'PaymentProviderError';
    this.status = options.status ?? null;
    this.refused = options.refused ?? false;
  }
}

export type WebhookRefusal = 'malformed' | 'refused';

export class WebhookVerificationError extends Error {
  constructor(
    message: string,
    readonly reason: WebhookRefusal,
  ) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface ProviderResult {
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed';
  settledAmountMinor?: number;
  settledCurrency?: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface WebhookDelivery {
  rawBody: string;
  headers: Record<string, string | undefined>;
}

export interface PaymentAdapter {
  readonly providerName: string;
  readonly handlesRealMoney: boolean;

  createCharge(req: ChargeRequest): Promise<ProviderResult>;
  createTopup(req: ChargeRequest): Promise<ProviderResult>;
  createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult>;
  getPayout(providerRef: string, options?: { signal?: AbortSignal }): Promise<ProviderResult>;
  verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent>;
}

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  environment: 'sandbox' | 'live';
  webhookId: string;
  fetchImpl?: typeof fetch;
}

const PAYPAL_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

function toDecimal(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

function toMinor(decimal: string): number {
  return Math.round(Number.parseFloat(decimal) * 100);
}

export function paypalPayoutItemOutcome(transactionStatus: string | undefined): ProviderResult['status'] {
  const s = (transactionStatus ?? '').toUpperCase();
  if (s === 'SUCCESS') return 'succeeded';
  if (['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED', 'DENIED', 'CANCELED', 'CANCELLED'].includes(s)) {
    return 'failed';
  }
  return 'pending';
}

export class PayPalPaymentAdapter implements PaymentAdapter {
  readonly providerName: string;
  readonly handlesRealMoney: boolean;

  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: PayPalConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error('PayPal is missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.');
    }
    if (!config.webhookId) {
      throw new Error(
        'PayPal is missing PAYPAL_WEBHOOK_ID. Without it a webhook cannot be verified, and an ' +
          'unverified webhook that credits a ledger is an open mint.',
      );
    }
    this.base = PAYPAL_BASE[config.environment];
    this.providerName = `paypal:${config.environment}`;
    this.handlesRealMoney = config.environment === 'live';
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async accessToken(signal?: AbortSignal): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now) return this.token.value;

    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64',
    );
    const res = await this.fetchImpl(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal,
    });
    if (!res.ok) {
      throw new PaymentProviderError(`PayPal auth failed (${res.status}). Check the client id and secret.`, {
        status: res.status,
      });
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: body.access_token,
      expiresAt: now + Math.max(0, body.expires_in - 60) * 1000,
    };
    return this.token.value;
  }

  private async call<T>(path: string, init: RequestInit & { idempotencyKey?: string }): Promise<T> {
    const token = await this.accessToken(init.signal ?? undefined);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (init.idempotencyKey) headers['PayPal-Request-Id'] = init.idempotencyKey;

    const res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers });
    const text = await res.text();
    if (!res.ok) {
      throw new PaymentProviderError(`PayPal ${path} failed (${res.status}): ${text.slice(0, 400)}`, {
        status: res.status,
        refused: res.status === 400 || res.status === 422,
      });
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async capture(req: ChargeRequest): Promise<ProviderResult> {
    const orderId = req.paymentMethodToken?.trim();
    if (!orderId) {
      throw new Error(
        'No PayPal order to capture. The payer must approve an order first; there is no way to ' +
          'take a payment without one.',
      );
    }

    const body = await this.call<{
      id: string;
      status: string;
      purchase_units?: {
        payments?: {
          captures?: { id: string; status?: string; amount: { value: string; currency_code: string } }[];
        };
      }[];
    }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      body: '{}',
      idempotencyKey: req.idempotencyKey,
      signal: req.signal,
    });

    const capture = body.purchase_units?.[0]?.payments?.captures?.[0];
    const captureStatus = (capture?.status ?? '').toUpperCase();
    const status: ProviderResult['status'] =
      captureStatus === 'COMPLETED'
        ? 'succeeded'
        : captureStatus === 'DECLINED' || captureStatus === 'FAILED'
          ? 'failed'
          : 'pending';
    return {
      providerRef: capture?.id ?? body.id,
      status,
      settledAmountMinor: capture ? toMinor(capture.amount.value) : undefined,
      settledCurrency: capture?.amount.currency_code,
    };
  }

  createCharge(req: ChargeRequest): Promise<ProviderResult> {
    return this.capture(req);
  }

  createTopup(req: ChargeRequest): Promise<ProviderResult> {
    return this.capture(req);
  }

  async createPayout(
    req: ChargeRequest & { destinationToken: string },
  ): Promise<ProviderResult> {
    if (!req.destinationToken?.trim()) {
      throw new Error('A payout needs a destination.');
    }

    const body = await this.call<{ batch_header: { payout_batch_id: string; batch_status: string } }>(
      '/v1/payments/payouts',
      {
        method: 'POST',
        idempotencyKey: req.idempotencyKey,
        signal: req.signal,
        body: JSON.stringify({
          sender_batch_header: {
            sender_batch_id: req.idempotencyKey,
            email_subject: 'Your Bault cash-out',
            email_message: 'The store credit you asked us to send back.',
          },
          items: [
            {
              recipient_type: 'EMAIL',
              receiver: req.destinationToken.trim(),
              amount: { value: toDecimal(req.amountMinor), currency: req.currency },
              sender_item_id: req.idempotencyKey,
            },
          ],
        }),
      },
    );

    const status = body.batch_header.batch_status;
    return {
      providerRef: body.batch_header.payout_batch_id,
      status: status === 'SUCCESS' ? 'succeeded' : status === 'DENIED' ? 'failed' : 'pending',
    };
  }

  async getPayout(providerRef: string, options: { signal?: AbortSignal } = {}): Promise<ProviderResult> {
    const body = await this.call<{
      batch_header: { payout_batch_id: string; batch_status: string };
      items?: { transaction_status?: string }[];
    }>(`/v1/payments/payouts/${encodeURIComponent(providerRef)}`, { method: 'GET', signal: options.signal });

    const item = body.items?.[0];
    const batch = (body.batch_header?.batch_status ?? '').toUpperCase();
    const status: ProviderResult['status'] = item
      ? paypalPayoutItemOutcome(item.transaction_status)
      : batch === 'DENIED' || batch === 'CANCELED'
        ? 'failed'
        : 'pending';
    return { providerRef: body.batch_header?.payout_batch_id ?? providerRef, status };
  }

  async verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent> {
    const h = (name: string): string => {
      const value = delivery.headers[name] ?? delivery.headers[name.toLowerCase()];
      if (!value) throw new WebhookVerificationError(`Webhook rejected: missing ${name}.`, 'malformed');
      return value;
    };

    let event: { id?: string; event_type?: string; resource?: Record<string, unknown> };
    try {
      event = JSON.parse(delivery.rawBody) as typeof event;
    } catch {
      throw new WebhookVerificationError('Webhook rejected: body is not JSON.', 'malformed');
    }

    let verdict: { verification_status: string };
    try {
      verdict = await this.call<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
        method: 'POST',
        body: JSON.stringify({
          transmission_id: h('paypal-transmission-id'),
          transmission_time: h('paypal-transmission-time'),
          cert_url: h('paypal-cert-url'),
          auth_algo: h('paypal-auth-algo'),
          transmission_sig: h('paypal-transmission-sig'),
          webhook_id: this.config.webhookId,
          webhook_event: JSON.parse(delivery.rawBody),
        }),
      });
    } catch (e) {
      if (e instanceof PaymentProviderError && e.refused) {
        throw new WebhookVerificationError(`Webhook rejected: PayPal refused to verify it (${e.status}).`, 'refused');
      }
      throw e;
    }

    if (verdict.verification_status !== 'SUCCESS') {
      throw new WebhookVerificationError('Webhook rejected: PayPal did not verify the signature.', 'refused');
    }

    return {
      id: event.id ?? '',
      type: event.event_type ?? 'unknown',
      data: event.resource ?? {},
    };
  }
}

export class SandboxPaymentAdapter implements PaymentAdapter {
  readonly providerName = 'sandbox';
  readonly handlesRealMoney = false;

  async createCharge(req: ChargeRequest): Promise<ProviderResult> {
    return {
      providerRef: `sbx_charge_${req.idempotencyKey}`,
      status: 'succeeded',
      settledAmountMinor: req.amountMinor,
      settledCurrency: req.currency,
    };
  }
  async createTopup(req: ChargeRequest): Promise<ProviderResult> {
    return {
      providerRef: `sbx_topup_${req.idempotencyKey}`,
      status: 'succeeded',
      settledAmountMinor: req.amountMinor,
      settledCurrency: req.currency,
    };
  }
  async createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult> {
    const to = req.destinationToken ?? '';
    const ref = (tag: string) => `sbx_payout_${tag}${req.idempotencyKey}`;
    if (to.includes('+payout-refused')) return { providerRef: ref(''), status: 'failed' };
    if (to.includes('+payout-pending')) return { providerRef: ref('pending_'), status: 'pending' };
    if (to.includes('+payout-settles')) return { providerRef: ref('settles_'), status: 'pending' };
    if (to.includes('+payout-bounces')) return { providerRef: ref('bounces_'), status: 'pending' };
    if (to.includes('+payout-lost') && !this.answered.has(req.idempotencyKey)) {
      this.answered.add(req.idempotencyKey);
      throw new PaymentProviderError('sandbox: the connection dropped after the payout was sent');
    }
    if (to.includes('+payout-slow')) await waitOrAbort(3_000, req.signal);
    if (to.includes('+payout-hang')) await waitOrAbort(24 * 60 * 60 * 1000, req.signal);
    return { providerRef: ref(''), status: 'succeeded' };
  }
  async getPayout(providerRef: string): Promise<ProviderResult> {
    if (providerRef.startsWith('sbx_payout_settles_')) return { providerRef, status: 'succeeded' };
    if (providerRef.startsWith('sbx_payout_bounces_')) return { providerRef, status: 'failed' };
    if (providerRef.startsWith('sbx_payout_pending_')) return { providerRef, status: 'pending' };
    return { providerRef, status: 'succeeded' };
  }
  private readonly answered = new Set<string>();
  async verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent> {
    const sig = delivery.headers['paypal-transmission-sig'] ?? delivery.headers['PAYPAL-TRANSMISSION-SIG'];
    if (sig === 'invalid') throw new WebhookVerificationError('Webhook rejected: sandbox signature marked invalid.', 'refused');
    let parsed: Partial<WebhookEvent>;
    try {
      parsed = JSON.parse(delivery.rawBody) as Partial<WebhookEvent>;
    } catch {
      throw new WebhookVerificationError('Webhook rejected: body is not JSON.', 'malformed');
    }
    return { id: parsed.id ?? 'sbx_evt', type: parsed.type ?? 'unknown', data: parsed.data ?? {} };
  }
}

function waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new PaymentProviderError('sandbox: the call was abandoned'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new PaymentProviderError('sandbox: the call was abandoned'));
    });
  });
}
