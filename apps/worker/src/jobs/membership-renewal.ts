import type { Pool } from 'pg';
import { log } from '../log';

export async function renewMemberships(pool: Pool): Promise<void> {
  let renewed = 0;
  let ended = 0;
  const failed: string[] = [];

  const closed = await pool.query(
    `UPDATE membership m
        SET status = 'ended', ended_at = now(), updated_at = now()
      WHERE m.current_period_end <= now()
        AND (m.status = 'cancelling'
             OR (m.status = 'active'
                 AND EXISTS (SELECT 1 FROM user_account u WHERE u.id = m.user_id AND u.status = 'closed')))`,
  );
  ended = closed.rowCount ?? 0;

  const due = await pool.query<{ id: string }>(
    `SELECT m.id
       FROM membership m
       JOIN user_account u ON u.id = m.user_id
      WHERE m.status = 'active'
        AND m.current_period_end <= now()
        AND u.status = 'active'`,
  );

  for (const { id } of due.rows) {
    const client = await pool.connect();
    let userId: string | undefined;
    try {
      await client.query('BEGIN');

      const claimed = await client.query<{
        user_id: string;
        tier: string;
        renews: Date;
      }>(
        `SELECT user_id, coalesce(scheduled_tier, tier) AS tier, current_period_end AS renews
           FROM membership
          WHERE id = $1
            AND status = 'active'
            AND current_period_end <= now()
          FOR UPDATE SKIP LOCKED`,
        [id],
      );
      const m = claimed.rows[0];
      if (!m) {
        await client.query('ROLLBACK');
        continue;
      }
      userId = m.user_id;

      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`wallet:${m.user_id}`]);

      const rule = await client.query<{ id: string; value: string; currency: string }>(
        `SELECT id, value::text, currency
           FROM pricing_rule
          WHERE action_type = $1
            AND effective_from <= now()
            AND (effective_to IS NULL OR effective_to > now())
          ORDER BY effective_from DESC
          LIMIT 1`,
        [`membership:${m.tier}`],
      );
      const priced = rule.rows[0];
      if (!priced) {
        await client.query('ROLLBACK');
        log.warn('no price for this tier — membership left lapsed', {
          job: 'membership.renewal',
          tier: m.tier,
          userId: m.user_id,
        });
        continue;
      }

      const feeMinor = Number(priced.value);
      const snapshot = JSON.stringify({ pricingRuleId: priced.id, actionType: `membership:${m.tier}`, renewal: true });

      const period = await client.query<{ period_start: string; period_end: string }>(
        `UPDATE membership
            SET tier = $2,
                scheduled_tier = NULL,
                current_period_start = date_trunc('milliseconds', now()),
                current_period_end   = date_trunc('milliseconds', now()) + interval '30 days',
                updated_at = now()
          WHERE id = $1
      RETURNING current_period_start AS period_start, current_period_end AS period_end`,
        [id, m.tier],
      );
      const p = period.rows[0]!;

      const inserted = await client.query(
        `INSERT INTO membership_period
           (membership_id, user_id, tier, period_start, period_end, fee, currency, pricing_rule_snapshot, consumed,
            renews_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, '{}'::jsonb, $9)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [id, m.user_id, m.tier, p.period_start, p.period_end, feeMinor, priced.currency, snapshot, m.renews],
      );
      if (inserted.rowCount === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      if (feeMinor > 0) {
        const charge = await client.query<{ id: string }>(
          `INSERT INTO charge
             (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, reference_id)
           VALUES ($1, $2, $3::jsonb, $4, $5, 'wallet', 'settled', $6)
           RETURNING id`,
          [m.user_id, `membership:${m.tier}`, snapshot, feeMinor, priced.currency, id],
        );
        await client.query(
          `INSERT INTO ledger_record
             (user_id, type, amount, direction, currency, reference_type, reference_id)
           VALUES ($1, 'service_charge', $2, 'debit', $3, 'charge', $4)`,
          [m.user_id, feeMinor, priced.currency, charge.rows[0]!.id],
        );
      }

      await client.query('COMMIT');
      renewed += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      failed.push(id);
      log.error('membership renewal failed', { job: 'membership.renewal', membershipId: id, userId, error: err });
    } finally {
      client.release();
    }
  }

  if (renewed > 0 || ended > 0 || failed.length > 0) {
    log.info('memberships rolled', { job: 'membership.renewal', renewed, ended, errored: failed.length });
  }
  if (failed.length > 0) {
    throw new Error(
      `membership renewal failed for ${failed.length} of ${due.rows.length} due: ${failed.join(', ')}`,
    );
  }
}
