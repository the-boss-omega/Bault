import type { Pool } from 'pg';
import { log } from '../log';

/**
 * Delete sign-in sessions a month after they stopped working.
 *
 * A session row is not history: it is not on the append-only list, and the
 * permanent record of who signed in, from where, is `login_attempt`, which this
 * never touches. Thirty days past expiry rather than at expiry, so the "where am
 * I signed in" view and an investigator asking about last week still see them.
 *
 * In batches, each claiming its rows with SKIP LOCKED, so a backlog is cleared
 * without one long-held lock, and two runs at once delete each row once.
 */
const RETENTION = '30 days';
const BATCH = 1_000;

export async function purgeExpiredSessions(pool: Pool): Promise<void> {
  let deleted = 0;
  for (;;) {
    const result = await pool.query(
      `DELETE FROM login_session
        WHERE id IN (
          SELECT id FROM login_session
           WHERE expires_at < now() - interval '${RETENTION}'
           ORDER BY expires_at
           LIMIT ${BATCH}
           FOR UPDATE SKIP LOCKED
        )`,
    );
    const n = result.rowCount ?? 0;
    deleted += n;
    if (n < BATCH) break;
  }
  log.info('expired sessions purged', { job: 'session.cleanup', deleted });
}
