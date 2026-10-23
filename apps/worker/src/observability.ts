import * as Sentry from '@sentry/node';
import { loadEnv, type Env } from '@bault/config';
import { scrubErrorEvent } from '@bault/adapters';

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

export function reportJobFailure(job: string, error: unknown): void {
  if (!enabled) return;
  Sentry.captureException(error, { tags: { job } });
}

export function reportAlert(message: string, fields: Record<string, unknown>, job?: string): void {
  if (!enabled) return;
  Sentry.captureMessage(message, { level: 'error', extra: fields, ...(job ? { tags: { job } } : {}) });
}

export async function flushErrorReporting(timeoutMs = 2_000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
