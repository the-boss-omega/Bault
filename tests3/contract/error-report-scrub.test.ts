import { describe, it, expect } from 'vitest';
import { scrubErrorEvent } from '@bault/adapters';

type Event = Parameters<typeof scrubErrorEvent>[0] & { message?: string; extra?: unknown };

const crashDuring = (method: string, url: string, data?: unknown): Event => ({
  message: 'boom',
  request: {
    method,
    url,
    headers: {
      cookie: 'session=s%3Asecret-session-value',
      Authorization: 'Bearer secret-token',
      'proxy-authorization': 'Basic c2VjcmV0',
      'user-agent': 'Mozilla/5.0',
      'x-request-id': 'req-1',
    },
    cookies: { session: 'secret-session-value' },
    ...(data !== undefined ? { data } : {}),
  },
});

const leaks = (event: Event | null, ...secrets: string[]) => {
  const text = JSON.stringify(event);
  return secrets.filter((s) => text.includes(s));
};

describe('every report', () => {
  it('loses the session cookie and every authorization header, and keeps the harmless headers', () => {
    const out = scrubErrorEvent(crashDuring('GET', 'http://api.local/api/v1/vault/items'));
    expect(leaks(out, 'secret-session-value', 'secret-token', 'c2VjcmV0')).toEqual([]);
    expect(out?.request?.cookies).toBeUndefined();
    expect(out?.request?.headers?.['user-agent']).toBe('Mozilla/5.0');
    expect(out?.request?.headers?.['x-request-id']).toBe('req-1');
  });

  it('keeps the field names of an ordinary request and none of what the customer typed', () => {
    const out = scrubErrorEvent(
      crashDuring('POST', '/api/v1/shipping/shipments', {
        recipientName: 'Red Ashwood',
        destinationAddress: { street1: '1140 W Addison St', city: 'Chicago', region: 'IL', postalCode: '60613', country: 'US' },
        itemIds: ['item-aaa', 'item-bbb'],
        parcels: [{ weightGrams: 410, note: 'fragile, leave with neighbour' }],
        insured: true,
        declaredValue: 98765,
      }),
    );
    expect(leaks(out, 'Red Ashwood', '1140 W Addison', 'Chicago', '60613', 'item-aaa', 'fragile', '98765')).toEqual([]);
    expect(out?.request?.data).toEqual([
      'declaredValue',
      'destinationAddress.city',
      'destinationAddress.country',
      'destinationAddress.postalCode',
      'destinationAddress.region',
      'destinationAddress.street1',
      'insured',
      'itemIds[]',
      'parcels[].note',
      'parcels[].weightGrams',
      'recipientName',
    ]);
    expect(out?.request?.method).toBe('POST');
    expect(out?.request?.url).toBe('/api/v1/shipping/shipments');
  });

  it('keeps the field names of a body that arrives as text, and drops text it cannot read', () => {
    const json = scrubErrorEvent(
      crashDuring('POST', '/api/v1/wallet/cash-out', JSON.stringify({ amount: 5000, destination: { email: 'red@example.test' } })),
    );
    expect(leaks(json, 'red@example.test', '5000')).toEqual([]);
    expect(json?.request?.data).toEqual(['amount', 'destination.email']);
    const form = scrubErrorEvent(crashDuring('POST', '/api/v1/support/tickets', 'subject=help&body=my+card+number+is+4111'));
    expect(leaks(form, '4111', 'help')).toEqual([]);
    expect(form?.request?.data).toEqual(['body', 'subject']);
    const prose = scrubErrorEvent(crashDuring('POST', '/api/v1/support/tickets', 'my card number is 4111'));
    expect(leaks(prose, '4111')).toEqual([]);
    expect(prose?.request?.data).toBeUndefined();
  });

  it('keeps the names of the query parameters and none of their values', () => {
    const event = crashDuring('GET', 'https://api.local/api/v1/marketplace/search?q=Red+Ashwood+collection&page=2');
    event.request!.query_string = 'q=Red+Ashwood+collection&page=2';
    const out = scrubErrorEvent(event);
    expect(leaks(out, 'Ashwood')).toEqual([]);
    expect(out?.request?.url).toBe('https://api.local/api/v1/marketplace/search');
    expect(out?.request?.query_string).toBe('q&page');
  });

  it('passes an event with no request through untouched', () => {
    const event: Event = { message: 'ledger invariant violated', extra: { orphanSettledCharges: 1 } };
    expect(scrubErrorEvent(event)).toEqual({ message: 'ledger invariant violated', extra: { orphanSettledCharges: 1 } });
  });
});

describe('a failed query', () => {
  const failed = 'Failed query: select * from user_account where email = $1 and last_name = $2\nparams: ann@example.test,Ashwood';

  it('loses the values from the exception, the message and a logged stack, and keeps the SQL', () => {
    const out = scrubErrorEvent({
      message: failed,
      exception: { values: [{ value: failed }] },
      breadcrumbs: [{ message: `${failed}\n    at NodePgPreparedQuery.queryWithCache (session.cjs:66:15)` }],
    } as Event & Record<string, unknown>) as Record<string, unknown>;
    expect(leaks(out as Event, 'ann@example.test', 'Ashwood')).toEqual([]);
    const text = JSON.stringify(out);
    expect(text).toContain('where email = $1 and last_name = $2');
    expect(text).toContain('queryWithCache');
  });
});

describe('a provider failure reported from any process', () => {
  it('keeps the provider, status and path, and loses the reply that quoted what was sent', () => {
    const easyPost = 'EasyPost 422 on /shipments: Unable to verify 1140 W Addison St for Red Ashwood';
    const payPal = 'PayPal /v1/payments/payouts failed (422): {"message":"receiver red@example.test is not eligible"}';
    const out = scrubErrorEvent({
      message: payPal,
      exception: { values: [{ value: easyPost }, { value: payPal }] },
      breadcrumbs: [{ message: `EasyPostError: ${easyPost}\n    at EasyPostShippingAdapter.call (easypost.js:96:13)` }],
    } as Event & Record<string, unknown>) as Record<string, unknown>;
    expect(leaks(out as Event, '1140 W Addison', 'Red Ashwood', 'red@example.test', 'not eligible')).toEqual([]);
    const text = JSON.stringify(out);
    expect(text).toContain('EasyPost 422 on /shipments');
    expect(text).toContain('PayPal /v1/payments/payouts failed (422)');
    expect(text).toContain('EasyPostShippingAdapter.call');
  });
});

describe('a crash on a credential route', () => {
  it('drops the body of a sign-in', () => {
    const out = scrubErrorEvent(
      crashDuring('POST', 'https://api.local/api/v1/auth/login', { identifier: 'red', password: 'hunter2-secret' }),
    );
    expect(leaks(out, 'hunter2-secret')).toEqual([]);
    expect(out?.request?.data).toBeUndefined();
  });

  it('drops the body of a registration and of a password reset, and the token in a link', () => {
    for (const url of ['/api/v1/auth/register', '/api/v1/auth/password/reset']) {
      const out = scrubErrorEvent(crashDuring('POST', url, { password: 'hunter2-secret', token: 'reset-token-xyz' }));
      expect(leaks(out, 'hunter2-secret', 'reset-token-xyz'), url).toEqual([]);
    }
    const link = crashDuring('GET', 'https://api.local/api/v1/auth/verify-email?token=verify-token-xyz');
    link.request!.query_string = 'token=verify-token-xyz';
    expect(leaks(scrubErrorEvent(link), 'verify-token-xyz')).toEqual([]);
  });

  it('drops the body of a password change, under any /me/password path', () => {
    for (const url of ['/api/v1/me/password', '/api/v1/me/password/confirm', 'http://x/api/v1/me/passwords']) {
      const out = scrubErrorEvent(
        crashDuring('PATCH', url, { currentPassword: 'old-secret-pw', newPassword: 'new-secret-pw' }),
      );
      expect(leaks(out, 'old-secret-pw', 'new-secret-pw'), url).toEqual([]);
    }
  });

  it('does not mistake a route that merely mentions the word for one of them', () => {
    const out = scrubErrorEvent(crashDuring('POST', '/api/v1/admin/authors-note', { note: 'typed by the customer' }));
    expect(out?.request?.data).toEqual(['note']);
    expect(leaks(out, 'typed by the customer')).toEqual([]);
  });
});
