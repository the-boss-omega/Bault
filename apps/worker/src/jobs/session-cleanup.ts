import type { Pool } from 'pg';
import { log } from '../log';

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
