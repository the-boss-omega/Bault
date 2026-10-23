import * as Sentry from '@sentry/node';
import { scrubErrorEvent } from '@bault/adapters';
import type { Env } from '@bault/config';

let enabled = false;

export function initErrorReporting(env: Pick<Env, 'SENTRY_DSN' | 'NODE_ENV'>): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,
    initialScope: { tags: { process: 'api' } },
    beforeSend: (event) => scrubErrorEvent(event),
  });
  enabled = true;
  return true;
}

export interface ReportedRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  data?: unknown;
  requestId?: string;
}

export type ExceptionReporter = (error: unknown, request?: ReportedRequest) => void;

export const EXCEPTION_REPORTER = Symbol('EXCEPTION_REPORTER');

export const reportException: ExceptionReporter = (error, request) => {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (request?.requestId) scope.setTag('request_id', request.requestId);
    if (request) {
      const { requestId: _id, ...http } = request;
      scope.addEventProcessor((event) => ({ ...event, request: { ...event.request, ...http } }));
    }
    Sentry.captureException(error);
  });
};

export async function flushErrorReporting(timeoutMs = 2_000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
