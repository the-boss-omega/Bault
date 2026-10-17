/**
 * What an error report may carry off the platform.
 *
 * Error reports go to a third party (Sentry) and are kept there, readable by
 * anyone with access to the project. The SDK attaches the request it can see:
 * the headers, the cookies and, for an incoming request, the body. Unscrubbed,
 * a crash in `POST /auth/login` would hand over the password being checked, and
 * every report would carry the session cookie, which IS the account until it
 * expires.
 *
 * This is the `beforeSend` hook both the API and the worker install, kept here
 * so the two processes cannot drift apart and so it can be tested without either.
 *
 * Typed structurally rather than against the SDK, so this package takes no
 * dependency on it; the SDK's own event type is assignable to this one.
 */
export interface ReportableRequest {
  method?: string;
  url?: string;
  query_string?: unknown;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  data?: unknown;
}

export interface ReportableEvent {
  request?: ReportableRequest;
}

/**
 * Headers that ARE credentials. Compared case-insensitively: Node lower-cases
 * incoming header names, but an event can be built by hand.
 */
const CREDENTIAL_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
]);

/**
 * Routes whose request body is a secret by construction: everything under
 * `/auth` (sign-in, registration, password reset and change, verification,
 * two-factor) and anything under `/me/password`. Their query strings go too,
 * because the verification and reset links carry their token there.
 *
 * `auth` is matched as a whole path SEGMENT, so `/admin/authors-note` is not
 * mistaken for an `/auth` route. `/me/password` is a prefix match on purpose,
 * so `/me/password/confirm` or `/me/passwords` would be covered too.
 */
const SECRET_BODY_ROUTES = [/(^|\/)auth(\/|$)/, /(^|\/)me\/password/];

function pathOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url, 'http://placeholder.invalid').pathname;
  } catch {
    return url.split('?')[0] ?? '';
  }
}

function withoutQuery(url: string): string {
  const at = url.indexOf('?');
  return at === -1 ? url : url.slice(0, at);
}

export function scrubErrorEvent<E extends ReportableEvent>(event: E): E {
  const request = event.request;
  if (!request) return event;

  const clean: ReportableRequest = { ...request };
  delete clean.cookies;

  if (request.headers) {
    clean.headers = Object.fromEntries(
      Object.entries(request.headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())),
    );
  }

  if (SECRET_BODY_ROUTES.some((route) => route.test(pathOf(request.url)))) {
    delete clean.data;
    delete clean.query_string;
    if (typeof clean.url === 'string') clean.url = withoutQuery(clean.url);
  }

  return { ...event, request: clean } as E;
}
