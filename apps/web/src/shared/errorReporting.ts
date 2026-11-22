export interface ReportContext {
  componentStack?: string | null;
}

export type ErrorReporter = (error: unknown, context?: ReportContext) => void;

export interface ReportingEnv {
  VITE_SENTRY_DSN?: string;
  VITE_RELEASE?: string;
  MODE?: string;
}

interface ScrubbableRequest {
  url?: string;
  headers?: Record<string, string>;
  cookies?: unknown;
  data?: unknown;
  query_string?: unknown;
}

interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ScrubbableEvent {
  request?: ScrubbableRequest;
  user?: unknown;
  breadcrumbs?: ScrubbableBreadcrumb[];
}

const CREDENTIAL_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-api-key']);

const URL_FIELDS = ['url', 'from', 'to'];

export function withoutQuery(url: string): string {
  const at = url.indexOf('#');
  const base = at === -1 ? url : url.slice(0, at);
  const fragment = at === -1 ? undefined : url.slice(at + 1);
  const cut = (part: string): string => part.split('?')[0] ?? '';
  return fragment === undefined ? cut(base) : `${cut(base)}#${cut(fragment)}`;
}

export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(breadcrumb: B): B | null {
  if (breadcrumb.category === 'console') return null;
  if (!breadcrumb.data) return breadcrumb;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(breadcrumb.data)) {
    if (key === 'body' || key === 'request_body' || key === 'response_body') continue;
    data[key] = URL_FIELDS.includes(key) && typeof value === 'string' ? withoutQuery(value) : value;
  }
  return { ...breadcrumb, data };
}

export function scrubBrowserEvent<E extends ScrubbableEvent>(event: E): E {
  const out: E = { ...event };
  delete out.user;
  if (event.request) {
    const request: ScrubbableRequest = { ...event.request };
    delete request.cookies;
    delete request.data;
    delete request.query_string;
    if (typeof request.url === 'string') request.url = withoutQuery(request.url);
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())),
      );
    }
    out.request = request;
  }
  if (event.breadcrumbs) {
    out.breadcrumbs = event.breadcrumbs
      .map((breadcrumb) => scrubBreadcrumb(breadcrumb))
      .filter((breadcrumb): breadcrumb is ScrubbableBreadcrumb => breadcrumb !== null);
  }
  return out;
}

type SentryBrowser = typeof import('@sentry/browser');

let reporter: ErrorReporter = () => {};

export const reportError: ErrorReporter = (error, context) => reporter(error, context);

export async function startErrorReporting(
  env: ReportingEnv = {
    VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN as string | undefined,
    VITE_RELEASE: import.meta.env.VITE_RELEASE as string | undefined,
    MODE: import.meta.env.MODE,
  },
  load: () => Promise<Pick<SentryBrowser, 'init' | 'captureException' | 'breadcrumbsIntegration'>> = () =>
    import('@sentry/browser'),
): Promise<boolean> {
  const dsn = env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return false;
  const sentry = await load();
  const release = env.VITE_RELEASE?.trim();
  sentry.init({
    dsn,
    ...(release ? { release } : {}),
    environment: env.MODE ?? 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { process: 'web' } },
    integrations: (defaults) => [
      ...defaults.filter((integration) => integration.name !== 'Breadcrumbs'),
      sentry.breadcrumbsIntegration({ console: false }),
    ],
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    beforeSend: (event) => scrubBrowserEvent(event),
  });
  reporter = (error, context) => {
    sentry.captureException(
      error,
      context?.componentStack ? { contexts: { react: { componentStack: context.componentStack } } } : undefined,
    );
  };
  return true;
}
