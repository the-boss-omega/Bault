import type { Pool } from 'pg';
import { log } from '../log';

/**
 * Membership renewal.
 *
 * A cycle is thirty days, and at the end of one of three things happens:
 *
 *   - **active** → a new cycle opens, the fee is charged, and the allowance
 *     counters start again from zero. Allowances do not roll over, which is
 *     what keeps Bault's maximum exposure per member finite and knowable.
 *   - **cancelling** → the membership ENDS. This is the only place a membership
 *     stops, so the end of one is a dated event with a row behind it rather than
 *     an absence somebody infers later.
 *   - **ended** → nothing. Left alone forever.
 *
 * WHY THIS IS SQL AND NOT THE NEST SERVICE. The worker is a separate process
 * with a `pg` pool and no dependency injection — the same reason the storage
 * sweep is SQL. `MembershipService.renewDue` exists for tests and for an
 * administrator triggering a roll by hand; this is the thing that actually runs
 * on a schedule.
 *
 * FAILING CLOSED IS THE SAFE DIRECTION, and it is worth saying why the worst
 * case here is mild: if this job does not run, a member's cycle lapses and
 * `MembershipService.consume` stops granting allowances, because it checks that
 * `now` falls inside the paid-up window. The member is then billed the ordinary
 * published price for the things they do — after approving each one, like
 * anybody else. They are never charged twice and never charged silently. The
 * next run of this job opens their cycle and the allowances come back.
 *
 * ONCE PER CYCLE, HOWEVER MANY RUNS (N15). Each membership is renewed in its own
 * transaction that first CLAIMS the row — `FOR UPDATE SKIP LOCKED`, re-checking
 * that the cycle is still due — so a second run either skips a row the first is
 * renewing or finds it no longer due. Underneath that, the new period records
 * the end of the cycle it renewed, and (membership, renewed cycle) is unique:
 * the period start was the run's own `now()`, so two overlapping runs used to
 * write two different starts, the old ON CONFLICT never fired, and the member
 * paid twice.
 *
 * ONLY FOR AN ACCOUNT THAT IS ACTIVE (N9). A closed account kept renewing and
 * paying every thirty days for a service it could not use; its membership now
 * ENDS at the close of the cycle it paid for, like a cancellation. A suspended
 * or pending one is not renewed and not charged, and its cycle is simply left
 * lapsed — the fail-closed state described above — until the account is active
 * again, when the next run renews it.
 */
export async function renewMemberships(pool: Pool): Promise<void> {
  let renewed = 0;
  let ended = 0;
  let errored = 0;

  // Cancelled memberships end at the close of the cycle they paid for. Taking
  // the allowance away at the moment somebody cancels would be charging for a
  // service and then withdrawing it. A closed account's membership ends the
  // same way: it can never be used again, so it must never be charged again.
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

      // The claim. Skips a membership another run is renewing right now, and
      // finds nothing if one already renewed it since the list above was read.
      const claimed = await client.query<{
        user_id: string;
        tier: string;
        renews: Date;
      }>(
        // The tier the NEXT cycle is on: a scheduled downgrade takes effect here.
        // Without this a downgrade was silently a cancellation (migration 0030).
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

      // Then the wallet, after the row the renewal is about — the lock order
      // every money movement in the API follows.
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`wallet:${m.user_id}`]);

      /**
       * The fee in force RIGHT NOW, not the one this member joined on.
       *
       * A renewal is a new purchase at the current price, which is why the
       * snapshot is taken again rather than copied forward. The price freeze
       * protects what was already charged; it does not freeze the future.
       */
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
        // No rule for this tier: do not guess a price, and do not silently
        // give the cycle away. Leave it lapsed and let it be noticed.
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
        // MILLISECONDS, not now()'s microseconds. The period row is found by
        // exact equality on this timestamp, and the value goes through a
        // JavaScript Date on its way into that row — which keeps milliseconds.
        // With raw now() the two never matched: after a renewal the member had
        // no current period, allowances stopped counting, and a covered parcel
        // could not be paid for at all. The API writes both from one Date, so
        // this is the one place the precisions could disagree.
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

      // ON CONFLICT DO NOTHING covers both unique keys: the period start, and
      // the cycle being renewed. Either way the cycle already has its period —
      // and its fee — so this run charges nothing.
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
      errored += 1;
      log.error('membership renewal failed', { job: 'membership.renewal', membershipId: id, userId, error: err });
    } finally {
      client.release();
    }
  }

  if (renewed > 0 || ended > 0 || errored > 0) {
    log.info('memberships rolled', { job: 'membership.renewal', renewed, ended, errored });
  }
}
