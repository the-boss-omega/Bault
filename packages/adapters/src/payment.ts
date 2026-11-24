import { createHash } from 'node:crypto';

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
  /** The provider's own name for why it refused, PayPal's `details[0].issue`, when it gave one. */
  readonly issue: string | null;

  constructor(message: string, options: { status?: number | null; refused?: boolean; issue?: string | null } = {}) {
    super(message);
    this.name = 'PaymentProviderError';
    this.status = options.status ?? null;
    this.refused = options.refused ?? false;
    this.issue = options.issue ?? null;
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

/** A checkout order for a cash-in: Bault fixes the amount, the payer approves it on PayPal's page. */
export interface CheckoutOrderRequest {
  amountMinor: number;
  currency: string;
  /** Sent as PayPal-Request-Id, so a resend returns the same order instead of a second one. */
  requestId: string;
  /** Bault's own payment id. PayPal echoes it on the capture and in its webhooks. */
  customId: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  /** `card` opens PayPal's page on the debit or credit card form, `paypal` on the PayPal sign-in. */
  landing: 'card' | 'paypal';
  signal?: AbortSignal;
}

export interface CheckoutOrder {
  orderId: string;
  /** Where the payer approves the order. Always PayPal's own page for the configured environment. */
  approveUrl: string;
}

/**
 * What became of a checkout order's capture. `succeeded` means PayPal completed the capture and holds
 * the money; `pending` that it holds it under review or the payer has not approved yet; `failed` that
 * nothing was taken; `reversed` that a completed capture was refunded or reversed afterwards.
 */
export interface CheckoutCapture {
  orderId: string;
  status: 'succeeded' | 'pending' | 'failed' | 'reversed';
  captureId: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** PayPal's fee on the capture (`seller_receivable_breakdown.paypal_fee`), when it reported one. */
  feeMinor: number | null;
  feeCurrency: string | null;
  customId: string | null;
  /** PayPal's reason, `status_details.reason`, when it gave one. */
  detail: string | null;
}

export interface PaymentAdapter {
  readonly providerName: string;
  readonly handlesRealMoney: boolean;

  createCharge(req: ChargeRequest): Promise<ProviderResult>;
  createTopup(req: ChargeRequest): Promise<ProviderResult>;
  createPayout(req: ChargeRequest & { destinationToken: string }): Promise<ProviderResult>;
  getPayout(providerRef: string, options?: { signal?: AbortSignal }): Promise<ProviderResult>;
  verifyWebhook(delivery: WebhookDelivery): Promise<WebhookEvent>;

  createCheckoutOrder(req: CheckoutOrderRequest): Promise<CheckoutOrder>;
  captureCheckoutOrder(orderId: string, options: { requestId: string; signal?: AbortSignal }): Promise<CheckoutCapture>;
  getCheckoutOrder(orderId: string, options?: { signal?: AbortSignal }): Promise<CheckoutCapture>;
}

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  environment: 'sandbox' | 'live';
  webhookId: string;
  payoutNote?: string;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_PAYOUT_NOTE = 'Your Card Embassy cash-out';

const PAYPAL_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

/** Where PayPal sends a payer to approve an order. An approval link anywhere else is refused. */
const PAYPAL_APPROVE_HOST = {
  sandbox: 'www.sandbox.paypal.com',
  live: 'www.paypal.com',
} as const;

function toDecimal(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

function toMinor(decimal: string): number {
  return Math.round(Number.parseFloat(decimal) * 100);
}

function assertCheckoutAmount(amountMinor: number): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(`A checkout order needs a whole, positive amount in cents, not ${amountMinor}.`);
  }
}

interface PayPalMoney {
  currency_code?: string;
  value?: string;
}

interface PayPalCaptureResource {
  id?: string;
  status?: string;
  amount?: PayPalMoney;
  custom_id?: string;
  status_details?: { reason?: string };
  seller_receivable_breakdown?: { paypal_fee?: PayPalMoney };
  supplementary_data?: { related_ids?: { order_id?: string } };
  links?: { href?: string; rel?: string }[];
}

interface PayPalOrderResource {
  id?: string;
  status?: string;
  purchase_units?: { custom_id?: string; payments?: { captures?: PayPalCaptureResource[] } }[];
  links?: { href?: string; rel?: string }[];
}

/** An exact number of cents from PayPal's decimal string, or null for anything that is not one. */
function exactMinor(money: PayPalMoney | undefined): { minor: number | null; currency: string | null } {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(money?.value?.trim() ?? '');
  const currency = typeof money?.currency_code === 'string' ? money.currency_code : null;
  if (!m) return { minor: null, currency };
  return { minor: Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')), currency };
}

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function captureStatus(status: string | undefined): CheckoutCapture['status'] {
  switch ((status ?? '').toUpperCase()) {
    case 'COMPLETED':
      return 'succeeded';
    case 'DECLINED':
    case 'FAILED':
      return 'failed';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
    case 'REVERSED':
      return 'reversed';
    default:
      return 'pending';
  }
}

function readCapture(
  capture: PayPalCaptureResource,
  status: CheckoutCapture['status'],
  orderId: string | null,
  customIdFallback: string | null,
): Omit<CheckoutCapture, 'orderId'> & { orderId: string | null } {
  const amount = exactMinor(capture.amount);
  const fee = capture.seller_receivable_breakdown?.paypal_fee
    ? exactMinor(capture.seller_receivable_breakdown.paypal_fee)
    : { minor: null, currency: null };
  return {
    orderId,
    status,
    captureId: nonEmpty(capture.id),
    amountMinor: amount.minor,
    currency: amount.currency,
    feeMinor: fee.minor,
    feeCurrency: fee.minor === null ? null : fee.currency,
    customId: nonEmpty(capture.custom_id) ?? customIdFallback,
    detail: nonEmpty(capture.status_details?.reason),
  };
}

/** What an Orders v2 order says about its capture. The last capture on the first purchase unit counts. */
export function checkoutFromOrder(body: PayPalOrderResource, orderIdAsked: string): CheckoutCapture {
  const orderId = nonEmpty(body.id) ?? orderIdAsked;
  const unit = body.purchase_units?.[0];
  const captures = unit?.payments?.captures ?? [];
  const capture = captures[captures.length - 1];
  const customId = nonEmpty(unit?.custom_id);
  if (capture) return { ...readCapture(capture, captureStatus(capture.status), orderId, customId), orderId };
  return {
    orderId,
    status: (body.status ?? '').toUpperCase() === 'VOIDED' ? 'failed' : 'pending',
    captureId: null,
    amountMinor: null,
    currency: null,
    feeMinor: null,
    feeCurrency: null,
    customId,
    detail: nonEmpty(body.status),
  };
}

/** A capture as one webhook reports it. The order may be unnamed (a refund names only its capture). */
export type CheckoutCaptureReport = Omit<CheckoutCapture, 'orderId'> & { orderId: string | null };

export type CheckoutEvent =
  | { kind: 'capture'; capture: CheckoutCaptureReport }
  | { kind: 'approved'; orderId: string; customId: string | null };

/**
 * The webhook events of a cash-in by checkout, and what each says became of the capture. The outcome is
 * the event type's, never the body's status. REVERSED and REFUNDED are read here so that whoever records
 * a cash-in taken back has them, but nothing credits or debits on them yet.
 */
export const CHECKOUT_CAPTURE_EVENTS: Readonly<Record<string, CheckoutCapture['status']>> = {
  'PAYMENT.CAPTURE.COMPLETED': 'succeeded',
  'PAYMENT.CAPTURE.PENDING': 'pending',
  'PAYMENT.CAPTURE.DENIED': 'failed',
  'PAYMENT.CAPTURE.DECLINED': 'failed',
  'PAYMENT.CAPTURE.REVERSED': 'reversed',
  'PAYMENT.CAPTURE.REFUNDED': 'reversed',
};

export const CHECKOUT_ORDER_APPROVED = 'CHECKOUT.ORDER.APPROVED';

export function checkoutCaptureFromEvent(event: WebhookEvent): CheckoutEvent | null {
  const type = (event.type ?? '').toUpperCase();
  const data = (event.data ?? {}) as PayPalCaptureResource & PayPalOrderResource;

  if (type === CHECKOUT_ORDER_APPROVED) {
    const orderId = nonEmpty(data.id);
    return orderId ? { kind: 'approved', orderId, customId: nonEmpty(data.purchase_units?.[0]?.custom_id) } : null;
  }

  const status = CHECKOUT_CAPTURE_EVENTS[type];
  if (!status) return null;
  const orderId = nonEmpty(data.supplementary_data?.related_ids?.order_id);
  // A refund or a reversal is reported as its own resource, which names the capture it undid by its "up" link.
  const up = (data.links ?? []).find((l) => l.rel === 'up' && /\/captures\/[^/?#]+/.test(l.href ?? ''));
  const capturedBy = status === 'reversed' && up ? decodeURIComponent(/\/captures\/([^/?#]+)/.exec(up.href!)![1]!) : null;
  const capture = readCapture(capturedBy ? { ...data, id: capturedBy } : data, status, orderId, null);
  if (!capture.orderId && !capture.customId && !capture.captureId) return null;
  return { kind: 'capture', capture };
}

/** PayPal's own name for a refusal: the first `details[].issue`, else the error `name`. */
function paypalIssue(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { name?: unknown; details?: { issue?: unknown }[] };
    return nonEmpty(parsed?.details?.[0]?.issue) ?? nonEmpty(parsed?.name);
  } catch {
    return null;
  }
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
        issue: paypalIssue(text),
      });
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private isApproveUrl(href: string): boolean {
    try {
      const url = new URL(href);
      return url.protocol === 'https:' && url.hostname === PAYPAL_APPROVE_HOST[this.config.environment];
    } catch {
      return false;
    }
  }

  async createCheckoutOrder(req: CheckoutOrderRequest): Promise<CheckoutOrder> {
    assertCheckoutAmount(req.amountMinor);
    const body = await this.call<PayPalOrderResource>('/v2/checkout/orders', {
      method: 'POST',
      idempotencyKey: req.requestId,
      signal: req.signal,
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: req.customId,
            custom_id: req.customId,
            description: req.description,
            amount: { currency_code: req.currency, value: toDecimal(req.amountMinor) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Card Embassy',
              landing_page: req.landing === 'card' ? 'GUEST_CHECKOUT' : 'LOGIN',
              shipping_preference: 'NO_SHIPPING',
              user_action: 'PAY_NOW',
              payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
              return_url: req.returnUrl,
              cancel_url: req.cancelUrl,
            },
          },
        },
      }),
    });
    const orderId = nonEmpty(body.id);
    if (!orderId) throw new PaymentProviderError('PayPal answered the new checkout order without an order id.');
    const href = (body.links ?? []).find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? '';
    if (!this.isApproveUrl(href)) {
      throw new PaymentProviderError(
        `PayPal gave order ${orderId} no approval page on https://${PAYPAL_APPROVE_HOST[this.config.environment]}, so the payer is not sent anywhere.`,
      );
    }
    return { orderId, approveUrl: href };
  }

  async captureCheckoutOrder(orderId: string, options: { requestId: string; signal?: AbortSignal }): Promise<CheckoutCapture> {
    const id = orderId.trim();
    if (!id) throw new Error('No PayPal order to capture.');
    try {
      const body = await this.call<PayPalOrderResource>(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
        method: 'POST',
        body: '{}',
        headers: { Prefer: 'return=representation' },
        idempotencyKey: options.requestId,
        signal: options.signal,
      });
      return checkoutFromOrder(body, id);
    } catch (e) {
      // Captured already, by an earlier attempt whose answer was lost: what PayPal holds is the answer.
      if (e instanceof PaymentProviderError && e.issue === 'ORDER_ALREADY_CAPTURED') {
        return this.getCheckoutOrder(id, { signal: options.signal });
      }
      throw e;
    }
  }

  async getCheckoutOrder(orderId: string, options: { signal?: AbortSignal } = {}): Promise<CheckoutCapture> {
    const id = orderId.trim();
    if (!id) throw new Error('No PayPal order to read.');
    const body = await this.call<PayPalOrderResource>(`/v2/checkout/orders/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal: options.signal,
    });
    return checkoutFromOrder(body, id);
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
            email_subject: this.config.payoutNote?.trim() || DEFAULT_PAYOUT_NOTE,
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

  /**
   * A checkout order here is approved the moment it exists: the approval link is the return link with
   * the order's token, as PayPal would add it. The order id carries what was ordered, so a capture after
   * an API restart still settles the right amount. The cents of the amount choose the outcome, the way
   * PayPal's own sandbox uses set amounts for its negative tests (see SANDBOX_CHECKOUT_CENTS).
   */
  async createCheckoutOrder(req: CheckoutOrderRequest): Promise<CheckoutOrder> {
    assertCheckoutAmount(req.amountMinor);
    const order: SandboxOrder = {
      a: req.amountMinor,
      c: req.currency,
      p: req.customId,
      r: createHash('sha256').update(req.requestId).digest('hex').slice(0, 16),
    };
    const orderId = `${SANDBOX_ORDER_PREFIX}${Buffer.from(JSON.stringify(order)).toString('base64url')}`;
    const join = req.returnUrl.includes('?') ? '&' : '?';
    return { orderId, approveUrl: `${req.returnUrl}${join}token=${encodeURIComponent(orderId)}&PayerID=SBXPAYER` };
  }

  async captureCheckoutOrder(orderId: string, _options: { requestId: string; signal?: AbortSignal }): Promise<CheckoutCapture> {
    const order = sandboxOrder(orderId);
    if (order.a % 100 === SANDBOX_CHECKOUT_CENTS.notApproved) {
      throw new PaymentProviderError('sandbox: the payer has not approved this order', {
        status: 422,
        refused: true,
        issue: 'ORDER_NOT_APPROVED',
      });
    }
    if (order.a % 100 === SANDBOX_CHECKOUT_CENTS.lost && !this.answered.has(orderId)) {
      this.answered.add(orderId);
      throw new PaymentProviderError('sandbox: the connection dropped after the capture was taken');
    }
    return sandboxCapture(orderId, order);
  }

  async getCheckoutOrder(orderId: string): Promise<CheckoutCapture> {
    const order = sandboxOrder(orderId);
    if (order.a % 100 === SANDBOX_CHECKOUT_CENTS.notApproved) {
      return { ...sandboxCapture(orderId, order), status: 'pending', captureId: null, amountMinor: null, currency: null, feeMinor: null, feeCurrency: null, detail: 'PAYER_ACTION_REQUIRED' };
    }
    return sandboxCapture(orderId, order);
  }

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

/**
 * The cents that make the sandbox's checkout capture go wrong, for tests and for trying the screens:
 * an amount of $50.91 is declined, $50.92 is held pending, $50.93 settles a dollar short, $50.94 was
 * never approved by the payer, and $50.95 loses the first answer to a capture that did happen.
 */
export const SANDBOX_CHECKOUT_CENTS = {
  declined: 91,
  pending: 92,
  short: 93,
  notApproved: 94,
  lost: 95,
} as const;

const SANDBOX_ORDER_PREFIX = 'SBXO-';

interface SandboxOrder {
  a: number;
  c: string;
  p: string;
  r: string;
}

function sandboxOrder(orderId: string): SandboxOrder {
  if (orderId.startsWith(SANDBOX_ORDER_PREFIX)) {
    try {
      const order = JSON.parse(Buffer.from(orderId.slice(SANDBOX_ORDER_PREFIX.length), 'base64url').toString('utf8')) as Partial<SandboxOrder>;
      if (Number.isInteger(order.a) && typeof order.c === 'string' && typeof order.p === 'string' && typeof order.r === 'string') {
        return order as SandboxOrder;
      }
    } catch {
      // not one of ours; refused below
    }
  }
  throw new PaymentProviderError(`sandbox: there is no checkout order ${orderId.slice(0, 40)}`, { status: 404 });
}

function sandboxCapture(orderId: string, order: SandboxOrder): CheckoutCapture {
  const cents = order.a % 100;
  const captureId = `SBXC-${createHash('sha256').update(orderId).digest('hex').slice(0, 20)}`;
  const amountMinor = cents === SANDBOX_CHECKOUT_CENTS.short ? order.a - 100 : order.a;
  const status: CheckoutCapture['status'] =
    cents === SANDBOX_CHECKOUT_CENTS.declined ? 'failed' : cents === SANDBOX_CHECKOUT_CENTS.pending ? 'pending' : 'succeeded';
  const feeMinor = status === 'succeeded' ? Math.round((amountMinor * 349) / 10_000) + 49 : null;
  return {
    orderId,
    status,
    captureId,
    amountMinor,
    currency: order.c,
    feeMinor,
    feeCurrency: feeMinor === null ? null : order.c,
    customId: order.p,
    detail: status === 'failed' ? 'DECLINED' : status === 'pending' ? 'PENDING_REVIEW' : null,
  };
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
