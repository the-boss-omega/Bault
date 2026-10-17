import { EventEmitter } from 'node:events';
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { EasyPostShippingAdapter, PaymentProviderError } from '@bault/adapters';

/**
 * What a customer is told when a provider fails underneath their request.
 *
 * The EasyPost adapter throws an `EasyPostError` carrying EASYPOST's HTTP
 * status. That status describes the conversation between Bault and EasyPost,
 * not between the customer and Bault: a 401 there means Bault's API key was
 * refused, and answered as a 401 here it tells the SPA the customer's session
 * is gone. So a provider error is answered in Bault's own terms: 502
 * `provider_unavailable` when the provider failed or refused Bault's
 * credentials, 400 `provider_rejected` with the provider's reason when it
 * refused what the customer entered (an address), never 401 or 403. The
 * original goes to the log.
 *
 * The errors are real ones: the adapter is driven against a stubbed `fetch`
 * that answers the way EasyPost does, and what it throws is handed to the
 * exception filter.
 */

process.env.NODE_ENV = 'test';

let filters: typeof import('../../apps/api/src/shared/errors/all-exceptions.filter');

beforeAll(async () => {
  await import('../../apps/api/node_modules/reflect-metadata/Reflect.js');
  filters = await import('../../apps/api/src/shared/errors/all-exceptions.filter');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ADDRESS = { name: 'Red Ashwood', street1: '1140 W Addison St', city: 'Chicago', region: 'IL', postalCode: '60613', country: 'US' };
const ORIGIN = { name: 'Bault', street1: '12 Ferry Street', city: 'Newark', region: 'NJ', postalCode: '07105', country: 'US' };

/** What the adapter throws when EasyPost answers `status` with `message`. */
async function easyPostFailure(status: number, message: string): Promise<unknown> {
  vi.stubGlobal('fetch', async () => ({
    ok: false,
    status,
    statusText: 'stub',
    text: async () => JSON.stringify({ error: { code: 'STUB', message } }),
  }));
  const adapter = new EasyPostShippingAdapter({ apiKey: 'EZTKstub', baseUrl: 'https://easypost.invalid/v2' });
  return adapter.getRates({ destination: ADDRESS, origin: ORIGIN, items: [{ weightGrams: 100 }] }).then(
    () => {
      throw new Error('expected the adapter to throw');
    },
    (e: unknown) => e,
  );
}

/** The filter's answer to `exception`, what it logged, and what it reported. */
async function answer(exception: unknown) {
  const reported: unknown[] = [];
  const filter = new filters.AllExceptionsFilter((error) => reported.push(error));
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  });
  const req = { method: 'POST', url: '/api/v1/shipping/quote', originalUrl: '/api/v1/shipping/quote', headers: {}, body: {} };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) };
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    filter.catch(exception, host as never);
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  const body = res.body as { error: { code: string; message: string } };
  return { status: res.statusCode, code: body.error.code, message: body.error.message, log: lines.join(''), reported };
}

describe('a shipping provider error, as the customer sees it', () => {
  it('answers a refused API key as the provider failing, never as the customer being signed out', async () => {
    const failure = await easyPostFailure(401, 'The API key provided is invalid.');
    const out = await answer(failure);
    expect({ status: out.status, code: out.code }).toEqual({ status: 502, code: 'provider_unavailable' });
    // Nothing about Bault's credentials reaches the customer; all of it reaches the log.
    expect(out.message).not.toMatch(/api key/i);
    expect(out.log).toContain('EasyPost 401');
    expect(out.reported).toEqual([failure]);
  });

  it('answers a forbidden account the same way', async () => {
    const out = await answer(await easyPostFailure(403, 'This account is not allowed to do that.'));
    expect({ status: out.status, code: out.code }).toEqual({ status: 502, code: 'provider_unavailable' });
  });

  it('answers an address the carrier rejects as the customer\'s to fix, with the carrier\'s reason', async () => {
    const out = await answer(await easyPostFailure(422, 'Unable to verify address.'));
    expect({ status: out.status, code: out.code }).toEqual({ status: 400, code: 'provider_rejected' });
    expect(out.message).toContain('Unable to verify address.');
    expect(out.message).not.toBe('Bad request.');
    // The customer's mistake is not a server failure.
    expect(out.reported).toHaveLength(0);
    expect(out.log).toContain('EasyPost 422');
  });

  it('answers a provider outage or a throttle as the provider failing', async () => {
    for (const status of [500, 503, 429, 404]) {
      const out = await answer(await easyPostFailure(status, 'Something went wrong on our side.'));
      expect({ status: out.status, code: out.code }, String(status)).toEqual({ status: 502, code: 'provider_unavailable' });
    }
  });

  it('never answers a payment provider\'s 401 as the customer being signed out', async () => {
    const out = await answer(new PaymentProviderError('PayPal 401: invalid client credentials', { status: 401 }));
    expect({ status: out.status, code: out.code }).toEqual({ status: 502, code: 'provider_unavailable' });
    expect(out.message).not.toMatch(/credential/i);
  });
});
