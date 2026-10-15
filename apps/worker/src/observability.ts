import * as Sentry from '@sentry/node';
import { loadEnv, type Env } from '@bault/config';
import { scrubErrorEvent } from '@bault/adapters';

/**
 * Error reporting for the worker (step 15), the same way the API does it.
 *
 * With `SENTRY_DSN` set, a job that fails and a ledger invariant that breaks are
 * reported; without it nothing here starts or sends anything. Errors only — no
 * tracing — and every event passes through the same scrubber the API installs,
 * so the two processes cannot differ on what leaves the platform.
 *
 * The worker's own unexpected crashes (an uncaught exception, an unhandled
 * rejection) are reported by the SDK's default integrations, which then let the
 * process exit as Node would have.
 */
let enabled = false;

export function initErrorReporting(env: Pick<Env, 'SENTRY_DSN' | 'NODE_ENV'> = loadEnv()): boolean {
  if (!env.SENTRY_DSN || enabled) return enabled;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,
    initialScope: { tags: { process: 'worker' } },
    beforeSend: (event) => scrubErrorEvent(event),
  });
  enabled = true;
  return true;
}

/** A job threw. Tagged with the job, so one failing job is one issue, not many. */
export function reportJobFailure(job: string, error: unknown): void {
  if (!enabled) return;
  Sentry.captureException(error, { tags: { job } });
}

/**
 * Something is wrong that is not an exception — a broken invariant. Sent at
 * error level with the numbers that describe it.
 */
export function reportAlert(message: string, fields: Record<string, unknown>, job?: string): void {
  if (!enabled) return;
  Sentry.captureMessage(message, { level: 'error', extra: fields, ...(job ? { tags: { job } } : {}) });
}

/** Give queued reports a moment to leave before the process exits. */
export async function flushErrorReporting(timeoutMs = 2_000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
