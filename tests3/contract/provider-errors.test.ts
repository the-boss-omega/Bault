import { EventEmitter } from 'node:events';
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { EasyPostShippingAdapter, PaymentProviderError } from '@bault/adapters';

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
    expect(out.message).not.toMatch(/api key/i);
    expect(out.log).toContain('EasyPost 401');
    expect(out.reported).toHaveLength(1);
    const reported = out.reported[0] as Error;
    expect(reported.name).toBe('EasyPostError');
    expect(reported.message).toBe('EasyPost 401 on /shipments');
    expect(reported.stack).toContain((failure as Error).stack!.split('\n').find((l) => /^\s+at /.test(l)));
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
    expect(out.reported).toHaveLength(0);
    expect(out.log).toContain('EasyPost 422');
  });

  it('answers a provider outage or a throttle as the provider failing', async () => {
    for (const status of [500, 503, 429, 404]) {
      const out = await answer(await easyPostFailure(status, 'Something went wrong on our side.'));
      expect({ status: out.status, code: out.code }, String(status)).toEqual({ status: 502, code: 'provider_unavailable' });
    }
  });

  it('reports an outage whose message quotes the address with its kind, status and path, and without the address', async () => {
    const failure = await easyPostFailure(500, 'Upstream carrier timed out validating 1140 W Addison St, Chicago IL 60613 for Red Ashwood.');
    const out = await answer(failure);
    expect({ status: out.status, code: out.code }).toEqual({ status: 502, code: 'provider_unavailable' });
    expect(out.reported).toHaveLength(1);
    const reported = out.reported[0] as Error;
    const text = `${reported.name} ${reported.message} ${reported.stack} ${JSON.stringify(reported)}`;
    for (const typed of ['1140 W Addison', 'Chicago', '60613', 'Red Ashwood', 'timed out']) {
      expect(text, typed).not.toContain(typed);
      expect(out.log, typed).not.toContain(typed);
    }
    expect(reported.message).toContain('500');
    expect(reported.message).toContain('/shipments');
    expect(out.log).toContain('shipping');
    expect(out.log).toContain('EasyPost 500 on /shipments');
  });

  it('never answers a payment provider\'s 401 as the customer being signed out', async () => {
    const out = await answer(new PaymentProviderError('PayPal 401: invalid client credentials', { status: 401 }));
    expect({ status: out.status, code: out.code }).toEqual({ status: 502, code: 'provider_unavailable' });
    expect(out.message).not.toMatch(/credential/i);
  });
});

describe('a unique violation nobody caught where it happened', () => {
  async function duplicateKey(): Promise<Error> {
    const { DrizzleQueryError } = await import('../../apps/api/node_modules/drizzle-orm/errors.js');
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "voucher_code_unique"'), {
      code: '23505',
      constraint: 'voucher_code_unique',
      table: 'voucher',
      detail: 'Key (code)=(GIFT-SECRET-42) already exists.',
    });
    return new DrizzleQueryError('insert into "voucher" ("code", "owner") values ($1, $2)', ['GIFT-SECRET-42', 'ann@example.test'], pg);
  }

  it('answers 409 conflict, and is still logged and reported without the values', async () => {
    const out = await answer(await duplicateKey());
    expect({ status: out.status, code: out.code }).toEqual({ status: 409, code: 'conflict' });
    expect(out.reported).toHaveLength(1);
    const reported = out.reported[0] as Error;
    expect(reported.message).toContain('23505');
    expect(reported.message).toContain('voucher_code_unique');
    expect(out.log).toContain('voucher_code_unique');
    const text = `${reported.message} ${reported.stack} ${out.log} ${out.message}`;
    expect(text).not.toContain('GIFT-SECRET-42');
    expect(text).not.toContain('ann@example.test');
  });
});
