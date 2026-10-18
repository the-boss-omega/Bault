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
  message?: string;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: { message?: string }[];
}

const QUERY_PARAMS = /(Failed query: [\s\S]*?\nparams: )[\s\S]*?(?=\n\s+at |$)/g;

function withoutQueryParams<T extends string | undefined>(text: T): T {
  return (typeof text === 'string' ? text.replace(QUERY_PARAMS, '$1[redacted]') : text) as T;
}

const CREDENTIAL_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
]);

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

export function scrubErrorEvent<E extends ReportableEvent>(input: E): E {
  const event = withoutQueryValues(input);
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

function withoutQueryValues<E extends ReportableEvent>(event: E): E {
  const out: E = { ...event };
  if (typeof event.message === 'string') out.message = withoutQueryParams(event.message);
  if (event.exception?.values) {
    out.exception = {
      ...event.exception,
      values: event.exception.values.map((v) => ({ ...v, value: withoutQueryParams(v.value) })),
    };
  }
  if (event.breadcrumbs) {
    out.breadcrumbs = event.breadcrumbs.map((b) => ({ ...b, message: withoutQueryParams(b.message) }));
  }
  return out;
}
