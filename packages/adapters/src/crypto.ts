import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentProviderError, WebhookVerificationError } from './payment';

export interface CryptoChargeRequest {
  amountMinor: number;
  currency: string;
  customId: string;
  redirectUrl: string;
  cancelUrl: string;
  signal?: AbortSignal;
}

export interface CryptoCharge {
  chargeId: string;
  hostedUrl: string;
  expiresAt: string | null;
}

export type CryptoChargeStatus = 'confirmed' | 'failed' | 'delayed' | 'pending';

export interface CryptoChargeReport {
  chargeId: string;
  status: CryptoChargeStatus;
  amountMinor: number | null;
  currency: string | null;
  customId: string | null;
  hostedUrl: string | null;
  expiresAt: string | null;
}

export interface CryptoWebhookEvent {
  id: string;
  type: string;
  charge: CryptoChargeReport | null;
}

export interface CryptoCheckoutProvider {
  readonly providerName: 'coinbase_commerce' | 'sandbox';
  readonly handlesRealMoney: boolean;
  createCharge(req: CryptoChargeRequest): Promise<CryptoCharge>;
  verifyWebhook(rawBody: string, signature: string | undefined): CryptoWebhookEvent;
  describeCharge(chargeId: string, options?: { signal?: AbortSignal }): Promise<CryptoChargeReport>;
}

export const CRYPTO_CHARGE_EVENTS: Readonly<Record<string, CryptoChargeStatus>> = {
  'charge:confirmed': 'confirmed',
  'charge:failed': 'failed',
  'charge:delayed': 'delayed',
  'charge:pending': 'pending',
};

export const CRYPTO_SIGNATURE_HEADER = 'x-cc-webhook-signature';

export const SANDBOX_CRYPTO_WEBHOOK_SECRET = 'bault-sandbox-crypto-webhook-secret';

const COINBASE_COMMERCE_BASE = 'https://api.commerce.coinbase.com';
const COINBASE_COMMERCE_VERSION = '2018-03-22';
const COINBASE_HOSTED_HOST = 'commerce.coinbase.com';

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function toDecimal(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

function exactMinor(amount: unknown): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(typeof amount === 'string' ? amount.trim() : '');
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

function assertChargeAmount(amountMinor: number, currency: string): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(`A crypto charge needs a whole, positive amount in cents, not ${amountMinor}.`);
  }
  if (currency !== 'USD') throw new Error(`A crypto charge is priced in USD, not ${currency}.`);
}

function signatureMatches(rawBody: string, signature: string | undefined, secret: string): boolean {
  const given = (signature ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  return timingSafeEqual(Buffer.from(given, 'hex'), expected);
}

function isHostedUrl(href: unknown): boolean {
  if (typeof href !== 'string') return false;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && url.hostname === COINBASE_HOSTED_HOST && url.port === '';
  } catch {
    return false;
  }
}

interface CoinbaseCharge {
  id?: string;
  hosted_url?: string;
  expires_at?: string;
  pricing?: { local?: { amount?: string; currency?: string } };
  metadata?: { customId?: string };
  timeline?: { status?: string }[];
}

function timelineStatus(charge: CoinbaseCharge): CryptoChargeStatus {
  const last = (charge.timeline ?? [])[(charge.timeline ?? []).length - 1]?.status?.toUpperCase() ?? '';
  if (last === 'COMPLETED' || last === 'RESOLVED') return 'confirmed';
  if (last === 'EXPIRED' || last === 'CANCELED' || last === 'CANCELLED') return 'failed';
  if (last === 'UNRESOLVED') return 'delayed';
  return 'pending';
}

function readCharge(charge: CoinbaseCharge, status: CryptoChargeStatus, fallbackId: string | null): CryptoChargeReport | null {
  const chargeId = nonEmpty(charge.id) ?? fallbackId;
  if (!chargeId) return null;
  return {
    chargeId,
    status,
    amountMinor: exactMinor(charge.pricing?.local?.amount),
    currency: nonEmpty(charge.pricing?.local?.currency),
    customId: nonEmpty(charge.metadata?.customId),
    hostedUrl: isHostedUrl(charge.hosted_url) ? charge.hosted_url! : null,
    expiresAt: nonEmpty(charge.expires_at),
  };
}

function readEvent(rawBody: string): CryptoWebhookEvent {
  let body: { event?: { id?: unknown; type?: unknown; data?: CoinbaseCharge } };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    throw new WebhookVerificationError('Webhook rejected: body is not JSON.', 'malformed');
  }
  const id = nonEmpty(body?.event?.id);
  const type = nonEmpty(body?.event?.type);
  if (!id || !type) throw new WebhookVerificationError('Webhook rejected: no event id or type.', 'malformed');
  const status = CRYPTO_CHARGE_EVENTS[type];
  return { id, type, charge: status && body.event?.data ? readCharge(body.event.data, status, null) : null };
}

export interface CoinbaseCommerceConfig {
  apiKey: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
}

export class CoinbaseCommerceProvider implements CryptoCheckoutProvider {
  readonly providerName = 'coinbase_commerce' as const;
  readonly handlesRealMoney = true;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CoinbaseCommerceConfig) {
    if (!config.apiKey) throw new Error('Coinbase Commerce is missing COINBASE_COMMERCE_API_KEY.');
    if (!config.webhookSecret) {
      throw new Error(
        'Coinbase Commerce is missing COINBASE_COMMERCE_WEBHOOK_SECRET. Without it a webhook cannot be verified, and an ' +
          'unverified webhook that credits a wallet is an open mint.',
      );
    }
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${COINBASE_COMMERCE_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CC-Api-Key': this.config.apiKey,
        'X-CC-Version': COINBASE_COMMERCE_VERSION,
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new PaymentProviderError(`Coinbase Commerce ${path.split('/').slice(0, 2).join('/')} failed (${res.status}): ${text.slice(0, 300)}`, {
        status: res.status,
        refused: res.status >= 400 && res.status < 500,
      });
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createCharge(req: CryptoChargeRequest): Promise<CryptoCharge> {
    assertChargeAmount(req.amountMinor, req.currency);
    const body = await this.call<{ data?: CoinbaseCharge }>('/charges', {
      method: 'POST',
      signal: req.signal,
      body: JSON.stringify({
        name: 'Card Embassy wallet cash-in',
        description: `Wallet cash-in of $${toDecimal(req.amountMinor)}`,
        pricing_type: 'fixed_price',
        local_price: { amount: toDecimal(req.amountMinor), currency: 'USD' },
        metadata: { customId: req.customId },
        redirect_url: req.redirectUrl,
        cancel_url: req.cancelUrl,
      }),
    });
    const chargeId = nonEmpty(body.data?.id);
    if (!chargeId) throw new PaymentProviderError('Coinbase Commerce answered the new charge without a charge id.');
    const hostedUrl = body.data?.hosted_url ?? '';
    if (!isHostedUrl(hostedUrl)) {
      throw new PaymentProviderError(`Coinbase Commerce gave charge ${chargeId} no hosted page on https://${COINBASE_HOSTED_HOST}.`);
    }
    return { chargeId, hostedUrl, expiresAt: nonEmpty(body.data?.expires_at) };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): CryptoWebhookEvent {
    if (!signatureMatches(rawBody, signature, this.config.webhookSecret)) {
      throw new WebhookVerificationError('Webhook rejected: the signature does not match the shared secret.', 'refused');
    }
    return readEvent(rawBody);
  }

  async describeCharge(chargeId: string, options: { signal?: AbortSignal } = {}): Promise<CryptoChargeReport> {
    const id = chargeId.trim();
    if (!id) throw new Error('No Coinbase Commerce charge to read.');
    const body = await this.call<{ data?: CoinbaseCharge }>(`/charges/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal: options.signal,
    });
    const charge = body.data ?? {};
    return readCharge(charge, timelineStatus(charge), id)!;
  }
}

const SANDBOX_CHARGE_PREFIX = 'SBXCH-';

interface SandboxCharge {
  a: number;
  c: string;
  p: string;
}

export class SandboxCryptoProvider implements CryptoCheckoutProvider {
  readonly providerName = 'sandbox' as const;
  readonly handlesRealMoney = false;

  private readonly webhookSecret = SANDBOX_CRYPTO_WEBHOOK_SECRET;

  async createCharge(req: CryptoChargeRequest): Promise<CryptoCharge> {
    assertChargeAmount(req.amountMinor, req.currency);
    const charge: SandboxCharge = { a: req.amountMinor, c: req.currency, p: req.customId };
    const chargeId = `${SANDBOX_CHARGE_PREFIX}${Buffer.from(JSON.stringify(charge)).toString('base64url')}`;
    const join = req.redirectUrl.includes('?') ? '&' : '?';
    return {
      chargeId,
      hostedUrl: `${req.redirectUrl}${join}charge=${createHash('sha256').update(chargeId).digest('hex').slice(0, 12)}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  verifyWebhook(rawBody: string, signature: string | undefined): CryptoWebhookEvent {
    if (!signatureMatches(rawBody, signature, this.webhookSecret)) {
      throw new WebhookVerificationError('Webhook rejected: the sandbox signature does not match.', 'refused');
    }
    return readEvent(rawBody);
  }

  async describeCharge(chargeId: string): Promise<CryptoChargeReport> {
    const charge = sandboxCharge(chargeId);
    return { chargeId, status: 'pending', amountMinor: charge.a, currency: charge.c, customId: charge.p, hostedUrl: null, expiresAt: null };
  }

  signedEvent(type: string, chargeId: string, eventId: string): { rawBody: string; signature: string } {
    const charge = sandboxCharge(chargeId);
    const rawBody = JSON.stringify({
      event: {
        id: eventId,
        type,
        data: {
          id: chargeId,
          pricing: { local: { amount: toDecimal(charge.a), currency: charge.c } },
          metadata: { customId: charge.p },
        },
      },
    });
    return { rawBody, signature: createHmac('sha256', this.webhookSecret).update(rawBody, 'utf8').digest('hex') };
  }
}

function sandboxCharge(chargeId: string): SandboxCharge {
  if (chargeId.startsWith(SANDBOX_CHARGE_PREFIX)) {
    try {
      const charge = JSON.parse(Buffer.from(chargeId.slice(SANDBOX_CHARGE_PREFIX.length), 'base64url').toString('utf8')) as Partial<SandboxCharge>;
      if (Number.isInteger(charge.a) && typeof charge.c === 'string' && typeof charge.p === 'string') return charge as SandboxCharge;
    } catch {
      throw new PaymentProviderError(`sandbox: there is no crypto charge ${chargeId.slice(0, 40)}`, { status: 404 });
    }
  }
  throw new PaymentProviderError(`sandbox: there is no crypto charge ${chargeId.slice(0, 40)}`, { status: 404 });
}

export class UnavailableCryptoProvider implements CryptoCheckoutProvider {
  readonly providerName = 'sandbox' as const;
  readonly handlesRealMoney = false;

  private refuse(): never {
    throw new Error('Crypto checkout has no processor here: set CRYPTO_PROVIDER=coinbase_commerce with its key and webhook secret.');
  }

  async createCharge(): Promise<CryptoCharge> {
    return this.refuse();
  }

  verifyWebhook(): CryptoWebhookEvent {
    throw new WebhookVerificationError('Webhook rejected: crypto checkout has no processor here.', 'refused');
  }

  async describeCharge(): Promise<CryptoChargeReport> {
    return this.refuse();
  }
}

export type CryptoSelection = {
  NODE_ENV: 'development' | 'test' | 'production';
  CRYPTO_PROVIDER: 'coinbase_commerce' | 'sandbox';
  COINBASE_COMMERCE_API_KEY: string;
  COINBASE_COMMERCE_WEBHOOK_SECRET: string;
};

export function createCryptoProvider(env: CryptoSelection): CryptoCheckoutProvider {
  if (env.CRYPTO_PROVIDER === 'coinbase_commerce') {
    return new CoinbaseCommerceProvider({ apiKey: env.COINBASE_COMMERCE_API_KEY, webhookSecret: env.COINBASE_COMMERCE_WEBHOOK_SECRET });
  }
  if (env.NODE_ENV === 'production') return new UnavailableCryptoProvider();
  return new SandboxCryptoProvider();
}
