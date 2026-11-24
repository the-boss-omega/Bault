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

const PROVIDER_REPLIES = [
  /(EasyPost \d{3} on [^\s:]+): [\s\S]*?(?=\n\s+at |$)/g,
  /(PayPal \S+ failed \(\d{3}\)): [\s\S]*?(?=\n\s+at |$)/g,
];

function withoutQueryParams<T extends string | undefined>(text: T): T {
  if (typeof text !== 'string') return text;
  return PROVIDER_REPLIES.reduce<string>(
    (out, reply) => out.replace(reply, '$1'),
    text.replace(QUERY_PARAMS, '$1[redacted]'),
  ) as T;
}

const CREDENTIAL_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
]);

const SECRET_BODY_ROUTES = [/(^|\/)auth(\/|$)/, /(^|\/)me\/password/, /(^|\/)me\/email(\/|$)/];

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

const MAX_FIELDS = 200;
const MAX_DEPTH = 8;

function fieldPaths(value: unknown, prefix: string, depth: number, into: Set<string>): void {
  if (into.size >= MAX_FIELDS) return;
  if (Array.isArray(value)) {
    if (value.length === 0 || depth >= MAX_DEPTH) {
      into.add(`${prefix}[]`);
      return;
    }
    for (const element of value) fieldPaths(element, `${prefix}[]`, depth + 1, into);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    if (depth >= MAX_DEPTH || keys.length === 0) {
      if (prefix) into.add(prefix);
      return;
    }
    for (const key of keys) {
      fieldPaths((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key, depth + 1, into);
    }
    return;
  }
  if (prefix) into.add(prefix);
}

const FORM_ENCODED = /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/;

function parsedText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (FORM_ENCODED.test(trimmed)) {
    return Object.fromEntries([...new URLSearchParams(trimmed).keys()].map((name) => [name, null]));
  }
  return undefined;
}

function bodyShape(data: unknown): string[] | undefined {
  const body = typeof data === 'string' ? parsedText(data) : data;
  if (typeof body !== 'object' || body === null) return undefined;
  const into = new Set<string>();
  fieldPaths(body, '', 0, into);
  return [...into].sort();
}

function queryNames(query: unknown, url: string | undefined): string | undefined {
  let text = '';
  if (typeof query === 'string') text = query;
  else if (Array.isArray(query)) text = query.map((pair) => (Array.isArray(pair) ? `${String(pair[0])}=` : '')).join('&');
  else if (typeof query === 'object' && query !== null) text = Object.keys(query).map((name) => `${name}=`).join('&');
  else if (typeof url === 'string' && url.includes('?')) text = url.slice(url.indexOf('?') + 1);
  const names = [...new Set(new URLSearchParams(text.replace(/^\?/, '')).keys())];
  return names.length > 0 ? names.join('&') : undefined;
}

export function scrubErrorEvent<E extends ReportableEvent>(input: E): E {
  const event = withoutQueryValues(input);
  const request = event.request;
  if (!request) return event;

  const clean: ReportableRequest = { ...request };
  delete clean.cookies;
  delete clean.data;
  delete clean.query_string;
  if (typeof clean.url === 'string') clean.url = withoutQuery(clean.url);

  if (request.headers) {
    clean.headers = Object.fromEntries(
      Object.entries(request.headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())),
    );
  }

  if (!SECRET_BODY_ROUTES.some((route) => route.test(pathOf(request.url)))) {
    const fields = bodyShape(request.data);
    if (fields) clean.data = fields;
    const names = queryNames(request.query_string, request.url);
    if (names) clean.query_string = names;
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

export type ReportFlusher = (timeoutMs: number) => Promise<void>;

export const SHUTDOWN_FLUSH_MS = 2_000;

export async function flushWithin(flush: ReportFlusher, timeoutMs: number = SHUTDOWN_FLUSH_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([flush(timeoutMs).catch(() => undefined), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export interface FatalExitProcess {
  on(event: 'uncaughtException' | 'unhandledRejection', listener: (error: unknown) => void): unknown;
  once(event: 'beforeExit', listener: () => void): unknown;
  exit(code: number): void;
}

export function flushReportsOnExit(
  proc: FatalExitProcess,
  flush: ReportFlusher,
  logFatal: (what: string, error: unknown) => void,
  timeoutMs: number = SHUTDOWN_FLUSH_MS,
): void {
  let dying = false;
  const fatal = (what: string) => (error: unknown) => {
    if (dying) return;
    dying = true;
    logFatal(what, error);
    void flushWithin(flush, timeoutMs).finally(() => proc.exit(1));
  };
  proc.on('uncaughtException', fatal('uncaught exception'));
  proc.on('unhandledRejection', fatal('unhandled rejection'));
  proc.once('beforeExit', () => void flushWithin(flush, timeoutMs));
}
