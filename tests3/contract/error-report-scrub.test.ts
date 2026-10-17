import { describe, it, expect } from 'vitest';
import { scrubErrorEvent } from '@bault/adapters';

/**
 * What an error report is allowed to carry off the platform.
 *
 * An exception report goes to a third party — Sentry — and is kept there, read
 * by whoever has access to the project, long after the request is forgotten. A
 * crash in the middle of `POST /auth/login` must not hand that third party the
 * password that was being checked, and no report at all may carry a session
 * cookie, which IS the account for as long as it is valid.
 *
 * Every case here is driven through the scrubber directly, the way the SDK's
 * `beforeSend` hook calls it, with the events shaped the way the SDK shapes them.
 */
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

  it('keeps the body of an ordinary request, which is what makes the report useful', () => {
    const out = scrubErrorEvent(crashDuring('POST', '/api/v1/vault/items', { description: 'Rayquaza VMAX' }));
    expect(out?.request?.data).toEqual({ description: 'Rayquaza VMAX' });
  });

  it('passes an event with no request through untouched', () => {
    const event: Event = { message: 'ledger invariant violated', extra: { orphanSettledCharges: 1 } };
    expect(scrubErrorEvent(event)).toEqual({ message: 'ledger invariant violated', extra: { orphanSettledCharges: 1 } });
  });
});

describe('a failed query', () => {
  // drizzle-orm's query error: the SQL, then the values it was run with.
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
    const out = scrubErrorEvent(crashDuring('POST', '/api/v1/admin/authors-note', { note: 'kept' }));
    expect(out?.request?.data).toEqual({ note: 'kept' });
  });
});
