import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const workerHeartbeat = pgTable('worker_heartbeat', {
  jobName: text('job_name').primaryKey(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastDurationMs: integer('last_duration_ms'),
  lastError: text('last_error'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
