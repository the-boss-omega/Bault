import type { Pool } from 'pg';
import { log } from '../log';

const PAGE = 500;

export async function recomputeUsageTiers(pool: Pool): Promise<void> {
  const started = await pool.query<{ at: Date }>(`SELECT now() AS at`);
  const since = started.rows[0]!.at;

  const ended = await pool.query(
    `UPDATE membership
        SET status = 'ended', ended_at = now(), scheduled_tier = NULL, updated_at = now()
      WHERE status <> 'ended'
        AND (honoured_until IS NULL OR honoured_until <= now() OR current_period_end <= now())`,
  );

  let after = '00000000-0000-0000-0000-000000000000';
  let considered = 0;
  const failed: string[] = [];
  for (;;) {
    const page = await pool.query<{ id: string }>(
      `SELECT id FROM user_account WHERE id > $1 ORDER BY id LIMIT $2`,
      [after, PAGE],
    );
    if (page.rows.length === 0) break;
    for (const { id } of page.rows) {
      try {
        await pool.query(`SELECT recompute_usage_tier($1::uuid, 'nightly')`, [id]);
      } catch (err) {
        failed.push(id);
        log.error('usage tier recompute failed', { job: 'usage-tier.recompute', userId: id, error: err });
      }
    }
    considered += page.rows.length;
    after = page.rows[page.rows.length - 1]!.id;
  }

  const changed = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM usage_tier_change WHERE reason = 'nightly' AND created_at >= $1`,
    [since],
  );
  log.info('usage tiers recomputed', {
    job: 'usage-tier.recompute',
    accounts: considered,
    changed: changed.rows[0]?.n ?? 0,
    honouredMembershipsEnded: ended.rowCount ?? 0,
    errored: failed.length,
  });
  if (failed.length > 0) {
    throw new Error(`usage tier recompute failed for ${failed.length} of ${considered} accounts: ${failed.join(', ')}`);
  }
}
