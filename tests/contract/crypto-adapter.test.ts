import { createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import {
  CoinbaseCommerceProvider,
  SANDBOX_CRYPTO_WEBHOOK_SECRET,
  SandboxCryptoProvider,
  UnavailableCryptoProvider,
  WebhookVerificationError,
  createCryptoProvider,
} from '@bault/adapters';

const API_KEY = 'cc-test-key-0123456789';
const SECRET = 'cc-test-webhook-secret';

function fakeFetch(answer: { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const request = {
  amountMinor: 5_000,
  currency: 'USD',
  customId: '7d3b0f8e-1f2a-4c5b-9d6e-0a1b2c3d4e5f',
  redirectUrl: 'https://app.example.com/?crypto=returned',
  cancelUrl: 'https://app.example.com/?crypto=cancelled',
};

const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('hex');

describe('Coinbase Commerce crypto checkout', () => {
  it('opens a fixed-price USD charge with the key in its header and nowhere else', async () => {
    const { impl, calls } = fakeFetch({
      status: 201,
      body: { data: { id: 'ch_1', hosted_url: 'https://commerce.coinbase.com/pay/ch_1', expires_at: '2026-11-22T20:00:00Z' } },
    });
    const provider = new CoinbaseCommerceProvider({ apiKey: API_KEY, webhookSecret: SECRET, fetchImpl: impl });
    const charge = await provider.createCharge(request);
    expect(charge).toEqual({ chargeId: 'ch_1', hostedUrl: 'https://commerce.coinbase.com/pay/ch_1', expiresAt: '2026-11-22T20:00:00Z' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.commerce.coinbase.com/charges');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['X-CC-Api-Key']).toBe(API_KEY);
    expect(headers['X-CC-Version']).toBe('2018-03-22');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      pricing_type: 'fixed_price',
      local_price: { amount: '50.00', currency: 'USD' },
      metadata: { customId: request.customId },
      redirect_url: request.redirectUrl,
      cancel_url: request.cancelUrl,
    });
    expect(String(calls[0]!.init.body)).not.toContain(API_KEY);
  });

  it('refuses a hosted page anywhere but Coinbase Commerce, and a price in another currency', async () => {
    const { impl } = fakeFetch({ body: { data: { id: 'ch_2', hosted_url: 'https://evil.example.com/pay' } } });
    const provider = new CoinbaseCommerceProvider({ apiKey: API_KEY, webhookSecret: SECRET, fetchImpl: impl });
    await expect(provider.createCharge(request)).rejects.toThrow(/hosted page/);
    await expect(provider.createCharge({ ...request, currency: 'EUR' })).rejects.toThrow(/USD/);
  });

  it('never puts the key in an error, or in anything it logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { impl } = fakeFetch({ status: 401, body: { error: { type: 'authorization_error', message: 'No such API key.' } } });
    const provider = new CoinbaseCommerceProvider({ apiKey: API_KEY, webhookSecret: SECRET, fetchImpl: impl });
    const failure = await provider.createCharge(request).catch((e: unknown) => e as Error);
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error).message)).not.toContain(API_KEY);
    for (const spy of [log, warn, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(API_KEY);
      spy.mockRestore();
    }
  });

  it('reads a charge back by its timeline', async () => {
    const { impl, calls } = fakeFetch({
      body: {
        data: {
          id: 'ch_3',
          hosted_url: 'https://commerce.coinbase.com/pay/ch_3',
          pricing: { local: { amount: '50.00', currency: 'USD' } },
          metadata: { customId: request.customId },
          timeline: [{ status: 'NEW' }, { status: 'PENDING' }, { status: 'COMPLETED' }],
        },
      },
    });
    const provider = new CoinbaseCommerceProvider({ apiKey: API_KEY, webhookSecret: SECRET, fetchImpl: impl });
    expect(await provider.describeCharge('ch_3')).toMatchObject({
      chargeId: 'ch_3',
      status: 'confirmed',
      amountMinor: 5_000,
      currency: 'USD',
      customId: request.customId,
    });
    expect(calls[0]!.url).toBe('https://api.commerce.coinbase.com/charges/ch_3');
  });

  it('verifies a webhook by HMAC SHA-256 of the raw body, and reads the charge events', () => {
    const provider = new CoinbaseCommerceProvider({ apiKey: API_KEY, webhookSecret: SECRET, fetchImpl: fakeFetch({ body: {} }).impl });
    const raw = JSON.stringify({
      id: 'delivery-1',
      event: {
        id: 'evt-1',
        type: 'charge:confirmed',
        data: { id: 'ch_4', pricing: { local: { amount: '12.30', currency: 'USD' } }, metadata: { customId: request.customId } },
      },
    });
    expect(provider.verifyWebhook(raw, sign(raw))).toEqual({
      id: 'evt-1',
      type: 'charge:confirmed',
      charge: { chargeId: 'ch_4', status: 'confirmed', amountMinor: 1_230, currency: 'USD', customId: request.customId, hostedUrl: null, expiresAt: null },
    });
    expect(provider.verifyWebhook(raw, sign(raw).toUpperCase()).id).toBe('evt-1');

    for (const bad of [undefined, '', 'nothex', sign(raw, 'another secret'), sign(`${raw} `)]) {
      expect(() => provider.verifyWebhook(raw, bad)).toThrow(WebhookVerificationError);
    }
    const other = JSON.stringify({ event: { id: 'evt-2', type: 'charge:created', data: { id: 'ch_5' } } });
    expect(provider.verifyWebhook(other, sign(other)).charge).toBeNull();
    expect(() => provider.verifyWebhook('not json', sign('not json'))).toThrow(/not JSON/);
  });

  it('will not be built without its key or its webhook secret', () => {
    expect(() => new CoinbaseCommerceProvider({ apiKey: '', webhookSecret: SECRET })).toThrow(/COINBASE_COMMERCE_API_KEY/);
    expect(() => new CoinbaseCommerceProvider({ apiKey: API_KEY, webhookSecret: '' })).toThrow(/COINBASE_COMMERCE_WEBHOOK_SECRET/);
  });
});

describe('the sandbox crypto processor', () => {
  it('opens a charge that only a delivery signed with the sandbox secret confirms', async () => {
    const sandbox = new SandboxCryptoProvider();
    const charge = await sandbox.createCharge(request);
    expect(charge.hostedUrl.startsWith(request.redirectUrl)).toBe(true);
    expect(await sandbox.describeCharge(charge.chargeId)).toMatchObject({ status: 'pending', amountMinor: 5_000, customId: request.customId });

    const { rawBody, signature } = sandbox.signedEvent('charge:confirmed', charge.chargeId, 'evt-sbx');
    expect(signature).toBe(sign(rawBody, SANDBOX_CRYPTO_WEBHOOK_SECRET));
    expect(sandbox.verifyWebhook(rawBody, signature).charge).toMatchObject({ chargeId: charge.chargeId, status: 'confirmed', amountMinor: 5_000 });
    expect(() => sandbox.verifyWebhook(rawBody, sign(rawBody, 'guess'))).toThrow(WebhookVerificationError);
  });

  it('is never chosen in production', async () => {
    const env = { CRYPTO_PROVIDER: 'sandbox' as const, COINBASE_COMMERCE_API_KEY: '', COINBASE_COMMERCE_WEBHOOK_SECRET: '' };
    expect(createCryptoProvider({ ...env, NODE_ENV: 'development' })).toBeInstanceOf(SandboxCryptoProvider);
    const production = createCryptoProvider({ ...env, NODE_ENV: 'production' });
    expect(production).toBeInstanceOf(UnavailableCryptoProvider);
    await expect(production.createCharge(request)).rejects.toThrow(/CRYPTO_PROVIDER=coinbase_commerce/);
    const raw = JSON.stringify({ event: { id: 'e', type: 'charge:confirmed', data: { id: 'x' } } });
    expect(() => production.verifyWebhook(raw, sign(raw, SANDBOX_CRYPTO_WEBHOOK_SECRET))).toThrow(WebhookVerificationError);
    expect(
      createCryptoProvider({ ...env, NODE_ENV: 'production', CRYPTO_PROVIDER: 'coinbase_commerce', COINBASE_COMMERCE_API_KEY: 'k', COINBASE_COMMERCE_WEBHOOK_SECRET: 's' }),
    ).toBeInstanceOf(CoinbaseCommerceProvider);
  });
});
