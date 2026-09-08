/**
 * Payment adapter (T020, Principle XIII).
 *
 * The platform stores ONLY provider tokens/refs — never raw card data. Every
 * method deals in opaque references.
 *
 * Two implementations ship: `PayPalPaymentAdapter`, which is the rail the
 * reference service actually uses, and `SandboxPaymentAdapter`, which settles
 * everything and is refused in production by the factory in
 * `apps/api/src/shared/adapters/adapters.module.ts`.
 */
export interface ChargeRequest {
  userId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  /**
   * A provider-side reference; NEVER a PAN/CVV.
   *
   * For PayPal this is the ORDER ID the payer approved in the PayPal window.
   * The adapter captures it, which is what makes the money real: an order id
   * cannot be invented, and capture fails unless a human approved that exact
   * order for that exact amount.
   */
  paymentMethodToken?: string;
}

export interface ProviderResult {
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed';
  /**
   * What the provider says was actually moved, in minor units.
   *
   * Present whenever the provider reported it. The caller must compare this
   * against what it asked for and refuse the difference — an approval for $1
   * must never credit $5,000, and only the provider knows which of those
   * happened.
   */
  settledAmountMinor?: number;
  settledCurrency?: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** Everything needed to authenticate a webhook — the body AND its headers. */
export interface WebhookDelivery {
  rawBody: string;
  headers: Record<string, string | undefined>;
}

export interface PaymentAdapter {
  /** A name for logs and for the "is this real money" banner. */
  readonly providerName: string;
  /** False when the adapter is pointed at a provider's test environment. */
  readonly handlesRealMoney: boolean;

  createCharge(req: ChargeRequest): Promise<ProviderResult>;
  createTopup(req: ChargeRequest): Promise<ProviderResult>;
  createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult>;
  /**
   * Authenticate a webhook delivery and return the parsed event.
   *
   * ASYNC and takes the whole delivery, because real verification is a network
   * call against the provider using several headers — not a string compare. It
   * MUST throw rather than return on a delivery it cannot authenticate.
   */
  verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent>;
}

/* ============================================================
   PayPal
   ============================================================ */

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  /** `sandbox` talks to PayPal's test environment with fake money. */
  environment: 'sandbox' | 'live';
  /** The webhook id PayPal issued for this endpoint. Required to verify. */
  webhookId: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const PAYPAL_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

/** PayPal deals in decimal strings; the ledger deals in integer minor units. */
function toDecimal(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

function toMinor(decimal: string): number {
  return Math.round(Number.parseFloat(decimal) * 100);
}

/**
 * PayPal, which is what the reference service takes money through.
 *
 * The shape of the integration follows PayPal's own model rather than pretending
 * to be a card processor:
 *
 *   TOP-UP is a CAPTURE, never a charge. The SPA creates an order and sends the
 *   payer to PayPal; PayPal returns an approved order id; this adapter captures
 *   it. That ordering is the whole security property. An order id cannot be
 *   guessed, and a capture only succeeds if a real person approved that exact
 *   order — so the failure this replaces, where any string in
 *   `paymentMethodToken` settled, is not expressible. The adapter also returns
 *   what PayPal says it captured, so the caller can refuse a mismatch.
 *
 *   CASH-OUT is a PAYOUT to an email address, which is how the reference service
 *   sends store credit back to a collector.
 *
 *   WEBHOOKS are verified by asking PayPal, using the five transmission headers
 *   plus the webhook id. There is no local secret to compare; the verification
 *   is a call, which is why the interface is async.
 *
 * `environment: 'sandbox'` is a first-class production-safe configuration. It
 * talks to PayPal's real API with real signatures and real webhooks, moving fake
 * money — which is exactly what is wanted to exercise the whole product before a
 * bank account exists. `handlesRealMoney` is false there so the product can say
 * so out loud rather than looking identical to the live rail.
 */
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

  /**
   * An OAuth token, cached until shortly before it expires.
   *
   * The 60-second haircut is deliberate: a token that expires in flight fails a
   * capture, and a failed capture on a payment the payer already approved is the
   * worst possible moment to be clever about caching.
   */
  private async accessToken(): Promise<string> {
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
    });
    if (!res.ok) {
      throw new Error(`PayPal auth failed (${res.status}). Check the client id and secret.`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: body.access_token,
      expiresAt: now + Math.max(0, body.expires_in - 60) * 1000,
    };
    return this.token.value;
  }

  private async call<T>(path: string, init: RequestInit & { idempotencyKey?: string }): Promise<T> {
    const token = await this.accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    // PayPal's own idempotency header. A double-clicked button, a retried
    // request and a redelivered webhook all converge on one movement.
    if (init.idempotencyKey) headers['PayPal-Request-Id'] = init.idempotencyKey;

    const res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`PayPal ${path} failed (${res.status}): ${text.slice(0, 400)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Capture an order the payer already approved.
   *
   * `paymentMethodToken` is that order's id. Its absence is an error rather than
   * a fallback, because the fallback is the bug: something has to have been
   * approved before anything can be captured.
   */
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
        payments?: { captures?: { id: string; amount: { value: string; currency_code: string } }[] };
      }[];
    }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      body: '{}',
      idempotencyKey: req.idempotencyKey,
    });

    const capture = body.purchase_units?.[0]?.payments?.captures?.[0];
    return {
      providerRef: capture?.id ?? body.id,
      status: body.status === 'COMPLETED' ? 'succeeded' : 'pending',
      // Reported so the caller can refuse a mismatch. The adapter does not
      // decide what a discrepancy means — that is a ledger decision.
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

  /**
   * Send money back out, to an email address.
   *
   * `destinationToken` is the recipient's PayPal email. PayPal accepts the batch
   * and settles asynchronously, so this returns `pending` on acceptance rather
   * than claiming the money has landed — the webhook says when it has.
   */
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

  /**
   * Ask PayPal whether it really sent this.
   *
   * There is no local secret to compare against — PayPal signs with a rotating
   * certificate and verification is a call carrying the five transmission
   * headers and the webhook id. A missing header is treated as a failed
   * verification rather than skipped, because "no signature" is the one case an
   * attacker controls completely.
   */
  async verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent> {
    const h = (name: string): string => {
      const value = delivery.headers[name] ?? delivery.headers[name.toLowerCase()];
      if (!value) throw new Error(`Webhook rejected: missing ${name}.`);
      return value;
    };

    let event: { id?: string; event_type?: string; resource?: Record<string, unknown> };
    try {
      event = JSON.parse(delivery.rawBody) as typeof event;
    } catch {
      throw new Error('Webhook rejected: body is not JSON.');
    }

    const verdict = await this.call<{ verification_status: string }>(
      '/v1/notifications/verify-webhook-signature',
      {
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
      },
    );

    if (verdict.verification_status !== 'SUCCESS') {
      throw new Error('Webhook rejected: PayPal did not verify the signature.');
    }

    return {
      id: event.id ?? '',
      type: event.event_type ?? 'unknown',
      data: event.resource ?? {},
    };
  }
}

/* ============================================================
   Sandbox
   ============================================================ */

/**
 * Deterministic in-memory sandbox for local dev and contract tests.
 *
 * It settles everything and authenticates nothing. That is correct for what it
 * is and catastrophic anywhere near production, which is why the factory refuses
 * to construct it when `NODE_ENV=production` — see
 * `apps/api/src/shared/adapters/adapters.module.ts`. `handlesRealMoney` is false
 * so the running product can say so rather than looking like a live rail.
 */
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
    return { providerRef: `sbx_payout_${req.idempotencyKey}`, status: 'succeeded' };
  }
  async verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent> {
    const parsed = JSON.parse(delivery.rawBody) as Partial<WebhookEvent>;
    return { id: parsed.id ?? 'sbx_evt', type: parsed.type ?? 'unknown', data: parsed.data ?? {} };
  }
}
