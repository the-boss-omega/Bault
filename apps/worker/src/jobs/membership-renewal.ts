import type { Pool } from 'pg';

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
 */
export async function renewMemberships(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let renewed = 0;
  let ended = 0;

  try {
    // Cancelled memberships end at the close of the cycle they paid for. Taking
    // the allowance away at the moment somebody cancels would be charging for a
    // service and then withdrawing it.
    const closed = await client.query(
      `UPDATE membership
          SET status = 'ended', ended_at = now(), updated_at = now()
        WHERE status = 'cancelling'
          AND current_period_end <= now()`,
    );
    ended = closed.rowCount ?? 0;

    const due = await client.query<{ id: string; user_id: string; tier: string }>(
      `SELECT id, user_id, tier
         FROM membership
        WHERE status = 'active'
          AND current_period_end <= now()`,
    );

    for (const m of due.rows) {
      try {
        await client.query('BEGIN');

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
          // eslint-disable-next-line no-console
          console.warn(`[job:membership-renewal] no price for tier ${m.tier} — ${m.user_id} left lapsed`);
          continue;
        }

        const feeMinor = Number(priced.value);
        const snapshot = JSON.stringify({ pricingRuleId: priced.id, actionType: `membership:${m.tier}`, renewal: true });

        const period = await client.query<{ period_start: string; period_end: string }>(
          `UPDATE membership
              SET current_period_start = now(),
                  current_period_end   = now() + interval '30 days',
                  updated_at = now()
            WHERE id = $1
        RETURNING current_period_start AS period_start, current_period_end AS period_end`,
          [m.id],
        );
        const p = period.rows[0]!;

        // ON CONFLICT DO NOTHING: two workers racing the same membership write
        // one period row, and the second one's charge is skipped below because
        // the insert reports no row.
        const inserted = await client.query(
          `INSERT INTO membership_period
             (membership_id, user_id, tier, period_start, period_end, fee, currency, pricing_rule_snapshot, consumed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, '{}'::jsonb)
           ON CONFLICT (membership_id, period_start) DO NOTHING
           RETURNING id`,
          [m.id, m.user_id, m.tier, p.period_start, p.period_end, feeMinor, priced.currency, snapshot],
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
            [m.user_id, `membership:${m.tier}`, snapshot, feeMinor, priced.currency, m.id],
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
        await client.query('ROLLBACK');
        // eslint-disable-next-line no-console
        console.error(`[job:membership-renewal] ${m.user_id} failed:`, err);
      }
    }
  } finally {
    client.release();
  }

  if (renewed > 0 || ended > 0) {
    // eslint-disable-next-line no-console
    console.log(`[job:membership-renewal] renewed ${renewed}, ended ${ended}`);
  }
}
