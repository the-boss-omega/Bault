/**
 * Payment adapter.
 *
 * The platform stores ONLY provider tokens and refs, never raw card data. Every
 * method deals in opaque references.
 *
 * Two implementations ship: `PayPalPaymentAdapter`, and `SandboxPaymentAdapter`,
 * which settles everything and is refused in production by
 * `createPaymentAdapter` in `select.ts`.
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
   * The adapter captures it: an order id cannot be invented, and capture fails
   * unless a human approved that exact order for that exact amount.
   */
  paymentMethodToken?: string;
  /**
   * Gives up on the call when aborted, so a provider that hangs cannot hold a
   * pooled connection or the wallet lock. The caller passes
   * `AbortSignal.timeout(...)` and treats the abort as "outcome unknown".
   */
  signal?: AbortSignal;
}

/**
 * A provider call that went wrong, and how wrong.
 *
 * `refused` is true only when the provider ANSWERED and the answer proves
 * nothing was or will be moved: a request it rejected as invalid. Everything
 * else (a timeout, a dropped connection, a 5xx, an expired credential) leaves
 * the outcome unknown: the provider may have acted before the failure, so the
 * caller must not treat it as a refusal and give money back on a guess.
 */
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

/**
 * A webhook delivery that could not be authenticated: a signature the
 * provider did not vouch for, a header missing, a body that is not an event.
 *
 * Its own class because the API answers it differently from every other
 * failure here: this one is the sender's (a 400), whereas a provider that
 * could not be asked is ours (a 5xx, so the real provider retries).
 */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface ProviderResult {
  providerRef: string;
  status: 'succeeded' | 'pending' | 'failed';
  /**
   * What the provider says was actually moved, in minor units.
   *
   * Present whenever the provider reported it. The caller must compare this
   * against what it asked for and refuse the difference: an approval for $1
   * must never credit $5,000.
   */
  settledAmountMinor?: number;
  settledCurrency?: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** Everything needed to authenticate a webhook: the body AND its headers. */
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
   * Ask the provider what became of a payout it accepted.
   *
   * `providerRef` is the provider's own id for it, as `createPayout` returned.
   * For reconciliation: a payout PayPal accepts is `pending`, and only this,
   * or a webhook, says whether it later landed or came back.
   */
  getPayout(providerRef: string, options?: { signal?: AbortSignal }): Promise<ProviderResult>;
  /**
   * Authenticate a webhook delivery and return the parsed event.
   *
   * ASYNC and takes the whole delivery, because real verification is a network
   * call against the provider using several headers, not a string compare. It
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
 * What a PayPal payout ITEM's `transaction_status` means for the collector.
 *
 * The item, not the batch: a batch is `SUCCESS` once PayPal has processed it,
 * which says nothing about whether this one recipient was paid. An item in a
 * successful batch can still be UNCLAIMED and come back thirty days later.
 * UNCLAIMED and ONHOLD are therefore still pending; only SUCCESS is money that
 * landed, and the statuses below are money that did not.
 */
export function paypalPayoutItemOutcome(transactionStatus: string | undefined): ProviderResult['status'] {
  const s = (transactionStatus ?? '').toUpperCase();
  if (s === 'SUCCESS') return 'succeeded';
  if (['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED', 'DENIED', 'CANCELED', 'CANCELLED'].includes(s)) {
    return 'failed';
  }
  return 'pending';
}

/**
 * PayPal.
 *
 * The integration follows PayPal's own model rather than pretending to be a card
 * processor:
 *
 *   TOP-UP is a CAPTURE, never a charge. The SPA creates an order and sends the
 *   payer to PayPal; PayPal returns an approved order id; this adapter captures
 *   it. That ordering is the whole security property: an order id cannot be
 *   guessed, and a capture only succeeds if a real person approved that exact
 *   order. The adapter also returns what PayPal says it captured, so the caller
 *   can refuse a mismatch.
 *
 *   CASH-OUT is a PAYOUT to an email address.
 *
 *   WEBHOOKS are verified by asking PayPal, using the five transmission headers
 *   plus the webhook id. There is no local secret to compare; the verification
 *   is a call, which is why the interface is async.
 *
 * `environment: 'sandbox'` is a first-class production-safe configuration. It
 * talks to PayPal's real API with real signatures and real webhooks, moving fake
 * money. `handlesRealMoney` is false there so the product can say so rather than
 * looking identical to the live rail.
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
   * The 60-second margin is deliberate: a token that expires in flight fails a
   * capture on a payment the payer already approved.
   */
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
      // Not a refusal of any payment: nothing was asked for yet, and fixing the
      // credential and asking again is the remedy.
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
    // PayPal's own idempotency header. A double-clicked button, a retried
    // request and a redelivered webhook all converge on one movement.
    if (init.idempotencyKey) headers['PayPal-Request-Id'] = init.idempotencyKey;

    const res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers });
    const text = await res.text();
    if (!res.ok) {
      // 400 and 422 are PayPal validating the request and rejecting it: nothing
      // was created. Any other failure may have happened after it acted.
      throw new PaymentProviderError(`PayPal ${path} failed (${res.status}): ${text.slice(0, 400)}`, {
        status: res.status,
        refused: res.status === 400 || res.status === 422,
      });
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Capture an order the payer already approved.
   *
   * `paymentMethodToken` is that order's id. Its absence is an error, never a
   * fallback: something has to have been approved before anything is captured.
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
    /**
     * The CAPTURE's status, never the order's.
     *
     * PayPal marks an order COMPLETED once it has been captured, while the
     * capture inside it can still be PENDING (an eCheck, a payment held for
     * review) and may yet be declined. No capture at all is pending too:
     * nothing has been taken yet.
     */
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
      // Reported so the caller can refuse a mismatch. What a discrepancy means
      // is a ledger decision, not the adapter's.
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
   * and settles asynchronously, so an accepted batch is `pending`; `getPayout`
   * or the webhook says when the money has landed.
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

  /**
   * What became of a payout batch, read from its one item.
   *
   * Bault sends one item per batch (one cash-out, one recipient), so the item's
   * `transaction_status` is the answer. A batch with no item yet is pending,
   * unless PayPal denied or cancelled the batch as a whole.
   */
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

  /**
   * Ask PayPal whether it really sent this.
   *
   * There is no local secret to compare against: PayPal signs with a rotating
   * certificate, and verification is a call carrying the five transmission
   * headers and the webhook id. A missing header is a failed verification, never
   * skipped, because "no signature" is the one case an attacker controls completely.
   */
  async verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent> {
    const h = (name: string): string => {
      const value = delivery.headers[name] ?? delivery.headers[name.toLowerCase()];
      if (!value) throw new WebhookVerificationError(`Webhook rejected: missing ${name}.`);
      return value;
    };

    let event: { id?: string; event_type?: string; resource?: Record<string, unknown> };
    try {
      event = JSON.parse(delivery.rawBody) as typeof event;
    } catch {
      throw new WebhookVerificationError('Webhook rejected: body is not JSON.');
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
      // PayPal answering that the verification request itself is invalid is a
      // verdict on the delivery's headers. Anything else (a 5xx, a timeout, a
      // bad credential) says nothing about the delivery and stays as it is.
      if (e instanceof PaymentProviderError && e.refused) {
        throw new WebhookVerificationError(`Webhook rejected: PayPal refused to verify it (${e.status}).`);
      }
      throw e;
    }

    if (verdict.verification_status !== 'SUCCESS') {
      throw new WebhookVerificationError('Webhook rejected: PayPal did not verify the signature.');
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
 * It settles everything and authenticates nothing, which is why
 * `createPaymentAdapter` (`select.ts`) refuses to construct it when
 * `NODE_ENV=production`. `handlesRealMoney` is false so the running product can
 * say so rather than looking like a live rail.
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
  /**
   * A payout, scripted by its destination.
   *
   * With no instruction it settles at once. A destination containing one of
   * these stages a case a real provider produces, so every outcome of a
   * cash-out can be exercised end to end against a running API:
   *
   *   +payout-pending   accepted, and stays pending however often it is asked
   *   +payout-settles   accepted; asked again, it has landed
   *   +payout-bounces   accepted; asked again, it came back
   *   +payout-refused   refused outright
   *   +payout-lost      paid, but the answer is lost: the first call throws, and
   *                     a retry with the same key reports it paid
   *   +payout-slow      settles after three seconds
   *   +payout-hang      never answers until the caller gives up
   *
   * The outcome a later `getPayout` reports is carried in the reference, so it
   * survives a restart of the API.
   */
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
  /** Keys whose first payout call has already "lost" its answer. */
  private readonly answered = new Set<string>();
  /**
   * Checks no signature, with one exception for tests: a delivery whose
   * `paypal-transmission-sig` is `invalid` is refused as unverifiable, so the
   * API's answer to a forged delivery can be exercised without PayPal.
   */
  async verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent> {
    const sig = delivery.headers['paypal-transmission-sig'] ?? delivery.headers['PAYPAL-TRANSMISSION-SIG'];
    if (sig === 'invalid') throw new WebhookVerificationError('Webhook rejected: sandbox signature marked invalid.');
    let parsed: Partial<WebhookEvent>;
    try {
      parsed = JSON.parse(delivery.rawBody) as Partial<WebhookEvent>;
    } catch {
      throw new WebhookVerificationError('Webhook rejected: body is not JSON.');
    }
    return { id: parsed.id ?? 'sbx_evt', type: parsed.type ?? 'unknown', data: parsed.data ?? {} };
  }
}

/** Resolve after `ms`, or reject as soon as `signal` aborts. */
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
