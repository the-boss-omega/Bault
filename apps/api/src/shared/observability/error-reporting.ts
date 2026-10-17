import * as Sentry from '@sentry/node';
import { scrubErrorEvent } from '@bault/adapters';
import type { Env } from '@bault/config';

/**
 * Error reporting.
 *
 * With `SENTRY_DSN` set, every server-side failure is reported; without it,
 * nothing here does anything at all (no SDK is started, no network is touched),
 * which is the right default for a laptop and for CI.
 *
 * Errors only. No tracing and no OpenTelemetry auto-instrumentation: that would
 * need the SDK loaded before everything else in the process and is a separate
 * decision with its own cost. What is reported is attached explicitly by the
 * exception filter, and EVERY event passes through `scrubErrorEvent` on its way
 * out, which removes cookies, credential headers and the body of anything under
 * `/auth` or `/me/password`.
 */
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

/** The parts of a request worth attaching to a report. Scrubbed before sending. */
export interface ReportedRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  data?: unknown;
  requestId?: string;
}

export type ExceptionReporter = (error: unknown, request?: ReportedRequest) => void;

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

/** Give queued reports a moment to leave before the process exits. */
export async function flushErrorReporting(timeoutMs = 2_000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
