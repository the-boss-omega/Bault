import type { Pool } from 'pg';
import { log } from './log';
import { reportJobFailure } from './observability';

/**
 * Run one scheduled job and leave a record that it ran.
 *
 * A success stamps `worker_heartbeat.last_success_at`, which
 * `GET /api/v1/readyz/worker` reads. A failure stamps `last_error` and
 * `last_error_at` WITHOUT touching the last success, is logged, reported, and
 * rethrown so pg-boss retries it.
 *
 * Writing the heartbeat never fails the job: a job that did its work and then
 * could not say so must not be retried for it.
 */
export async function runScheduledJob(pool: Pool, name: string, run: () => Promise<void>): Promise<void> {
  const started = Date.now();
  try {
    await run();
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1_000);
    log.error(`job ${name} failed`, { job: name, error: err, duration_ms: Date.now() - started });
    reportJobFailure(name, err);
    await pool
      .query(
        `INSERT INTO worker_heartbeat (job_name, last_error, last_error_at, updated_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (job_name) DO UPDATE
           SET last_error = EXCLUDED.last_error, last_error_at = now(), updated_at = now()`,
        [name, message],
      )
      .catch((hbErr: Error) => log.warn('could not record the job failure', { job: name, error: hbErr.message }));
    throw err;
  }

  const durationMs = Date.now() - started;
  await pool
    .query(
      `INSERT INTO worker_heartbeat (job_name, last_success_at, last_duration_ms, updated_at)
       VALUES ($1, now(), $2, now())
       ON CONFLICT (job_name) DO UPDATE
         SET last_success_at = now(), last_duration_ms = EXCLUDED.last_duration_ms, updated_at = now()`,
      [name, durationMs],
    )
    .catch((hbErr: Error) => log.warn('could not record the heartbeat', { job: name, error: hbErr.message }));
  log.debug(`job ${name} succeeded`, { job: name, duration_ms: durationMs });
}
