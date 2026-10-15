import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The worker's heartbeat (migration 0032).
 *
 * One row per scheduled job, stamped by the worker each time that job succeeds
 * and, separately, each time it fails. The worker is a different process with
 * no HTTP port, so this row is the only evidence the rest of the platform has
 * that it is alive — `GET /readyz/worker` reads it.
 *
 * `lastError` is for an operator at the database, never for the probe: an
 * error message can carry a hostname, an address or a query.
 */
export const workerHeartbeat = pgTable('worker_heartbeat', {
  jobName: text('job_name').primaryKey(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastDurationMs: integer('last_duration_ms'),
  lastError: text('last_error'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
