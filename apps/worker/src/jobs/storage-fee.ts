import type { Pool } from 'pg';
import { log } from '../log';
import { renewMemberships } from './membership-renewal';

const SWEEP_LOCK = 'job:storage-fee';

const COVERED = `
  member_cap AS (
    SELECT m.user_id::text AS user_id,
           COALESCE((pr.parameters ->> 'storedItems')::int, 0) AS stored_items
      FROM membership m
      JOIN LATERAL (
        SELECT parameters
          FROM pricing_rule
         WHERE action_type = 'membership:' || m.tier
           AND effective_from <= now()
           AND (effective_to IS NULL OR effective_to > now())
         ORDER BY effective_from DESC
         LIMIT 1
      ) pr ON TRUE
     WHERE m.status IN ('active', 'cancelling')
       AND now() >= m.current_period_start
       AND now() <  m.current_period_end
  ),
  member_covered AS (
    SELECT r.id
      FROM (
        SELECT i.id,
               row_number() OVER (
                 PARTITION BY i.owner_id ORDER BY i.received_at ASC, i.id ASC
               ) AS rn,
               c.stored_items
          FROM item i
          JOIN member_cap c ON c.user_id = i.owner_id
         WHERE i.lifecycle_state = 'stored'
           AND NOT i.lot_broken
           AND i.received_at IS NOT NULL
      ) r
     WHERE r.rn <= r.stored_items
  )`;

export async function runStorageFees(pool: Pool): Promise<void> {
  await renewMemberships(pool).catch((err: Error) =>
    log.warn('some memberships could not be renewed before billing', { job: 'storage-fee.run', error: err.message }),
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [SWEEP_LOCK]);

    const rules = await client.query<{
      action_type: string;
      id: string;
      value: string;
      currency: string;
      effective_from: Date;
      item_class: string | null;
      model: string;
      parameters: Record<string, unknown> | null;
    }>(
      `SELECT DISTINCT ON (action_type)
              action_type, id, value, currency, effective_from, item_class, model, parameters
         FROM pricing_rule
        WHERE action_type IN ('storage', 'storage_oversized')
          AND effective_from <= now()
          AND (effective_to IS NULL OR effective_to > now())
        ORDER BY action_type, effective_from DESC`,
    );

    const byAction = new Map(rules.rows.map((r) => [r.action_type, r]));
    const standard = byAction.get('storage');
    if (!standard) {
      await client.query('ROLLBACK');
      log.warn('no storage pricing rule in force — nothing billed', { job: 'storage-fee.run' });
      return;
    }
    const oversized = byAction.get('storage_oversized') ?? standard;

    const num = (raw: Record<string, unknown> | null, key: string, dflt: number): number => {
      const v = (raw ?? {})[key];
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : dflt;
    };

    const params = {
      standard: {
        freeDays: num(standard.parameters, 'freeDays', 180),
        periodDays: Math.max(1, num(standard.parameters, 'periodDays', 90)),
        bps: num(standard.parameters, 'percentOfIntakeBps', 1000),
        ruleId: standard.id,
        currency: standard.currency,
        flat: Number(standard.value),
        effectiveFrom: standard.effective_from,
      },
      oversized: {
        freeDays: num(oversized.parameters, 'freeDays', 90),
        periodDays: Math.max(1, num(oversized.parameters, 'periodDays', 90)),
        bps: num(oversized.parameters, 'percentOfIntakeBps', 10000),
        ruleId: oversized.id,
        currency: oversized.currency,
        flat: Number(oversized.value),
        effectiveFrom: oversized.effective_from,
      },
    };

    const covered = await client.query(
      `WITH ${COVERED}
       INSERT INTO storage_cover (item_id, covered_until)
       SELECT id, now() FROM member_covered
       ON CONFLICT (item_id) DO UPDATE SET covered_until = EXCLUDED.covered_until`,
    );

    const due = await client.query<{
      item_id: string;
      owner_id: string;
      oversized: boolean;
      periods_due: string;
      amount: string;
    }>(
      `WITH policy AS (
         SELECT $1::int  AS std_free,  $2::int AS std_period,  $3::int AS std_bps,  $4::bigint AS std_flat,
                $5::int  AS ovr_free,  $6::int AS ovr_period,  $7::int AS ovr_bps,  $8::bigint AS ovr_flat
       ),
       ${COVERED},
       stored AS (
         SELECT i.id,
                i.owner_id,
                i.oversized,
                i.received_at,
                sc.covered_until,
                COALESCE(
                  (SELECT c.amount FROM charge c
                    WHERE c.action_type = 'intake' AND c.reference_id = i.id::text
                    ORDER BY c.created_at DESC LIMIT 1),
                  CASE WHEN i.oversized THEN (SELECT ovr_flat FROM policy)
                       ELSE (SELECT std_flat FROM policy) END
                ) AS intake_minor,
                (SELECT count(*) FROM charge c
                  WHERE c.action_type IN ('storage', 'storage_oversized')
                    AND c.reference_id = i.id::text
                    AND c.created_at >= COALESCE(sc.covered_until, '-infinity'::timestamptz)) AS periods_billed
           FROM item i
           LEFT JOIN storage_cover sc ON sc.item_id = i.id
          WHERE i.lifecycle_state = 'stored'
            AND NOT i.lot_broken
            AND i.received_at IS NOT NULL
            AND i.id NOT IN (SELECT id FROM member_covered)
       ),
       computed AS (
         SELECT s.id,
                s.owner_id,
                s.oversized,
                s.intake_minor,
                s.periods_billed,
                CASE WHEN s.oversized THEN p.ovr_free ELSE p.std_free END   AS free_days,
                CASE WHEN s.oversized THEN p.ovr_period ELSE p.std_period END AS period_days,
                CASE WHEN s.oversized THEN p.ovr_bps ELSE p.std_bps END      AS bps,
                s.received_at,
                s.covered_until
           FROM stored s CROSS JOIN policy p
       ),
       -- When this item's chargeable clock started: the end of its included
       -- window, or the last time a membership covered it, whichever is later.
       anchored AS (
         SELECT c.*,
                GREATEST(c.received_at + make_interval(days => c.free_days), c.covered_until) AS clock_from
           FROM computed c
       ),
       elapsed AS (
         SELECT a.*,
                -- Periods that have STARTED since the clock started.
                -- floor(days_since / period) + 1, never below zero.
                GREATEST(
                  0,
                  FLOOR(
                    EXTRACT(EPOCH FROM (now() - a.clock_from))
                    / (a.period_days * 86400.0)
                  )::int + 1
                ) AS periods_elapsed
           FROM anchored a
          WHERE now() >= a.clock_from
       )
       SELECT id AS item_id,
              owner_id,
              oversized,
              (periods_elapsed - periods_billed)::text AS periods_due,
              GREATEST(1, ROUND(intake_minor * bps / 10000.0))::bigint::text AS amount
         FROM elapsed
        WHERE periods_elapsed > periods_billed`,
      [
        params.standard.freeDays,
        params.standard.periodDays,
        params.standard.bps,
        params.standard.flat,
        params.oversized.freeDays,
        params.oversized.periodDays,
        params.oversized.bps,
        params.oversized.flat,
      ],
    );

    let chargedCount = 0;
    let totalAmount = 0;
    const itemIds: string[] = [];
    const accountIds = new Set<string>();

    for (const row of due.rows) {
      const periods = Number(row.periods_due);
      const amount = Number(row.amount);
      if (periods <= 0 || amount <= 0) continue;

      const variant = row.oversized ? params.oversized : params.standard;
      const actionType = row.oversized ? 'storage_oversized' : 'storage';
      const snapshot = {
        ruleId: variant.ruleId,
        actionType,
        model: 'percentage_of_intake',
        freeDays: variant.freeDays,
        periodDays: variant.periodDays,
        percentOfIntakeBps: variant.bps,
        currency: variant.currency,
        effectiveFrom: variant.effectiveFrom,
      };

      for (let i = 0; i < periods; i += 1) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, reference_id)
           VALUES ($1, $2, $3::jsonb, $4::bigint, $5, 'wallet', 'settled', $6)
           RETURNING id`,
          [row.owner_id, actionType, JSON.stringify(snapshot), amount, variant.currency, row.item_id],
        );
        const chargeId = inserted.rows[0]?.id;
        if (!chargeId) continue;
        await client.query(
          `INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type, reference_id)
           VALUES ($1, 'service_charge', $2::bigint, 'debit', $3, 'charge', $4)`,
          [row.owner_id, amount, variant.currency, chargeId],
        );
        chargedCount += 1;
        totalAmount += amount;
      }

      itemIds.push(row.item_id);
      accountIds.add(row.owner_id);
    }

    await client.query(
      `INSERT INTO storage_fee_run
         (threshold_days, triggered_by, charged_item_ids, charged_account_ids, total_amount, currency)
       VALUES ($1::int, 'system', $2::jsonb, $3::jsonb, $4::bigint, $5)`,
      [
        params.standard.freeDays,
        JSON.stringify(itemIds),
        JSON.stringify([...accountIds]),
        totalAmount,
        params.standard.currency,
      ],
    );

    await client.query('COMMIT');
    log.info('storage fees billed', {
      job: 'storage-fee.run',
      periods: chargedCount,
      items: itemIds.length,
      accounts: accountIds.size,
      total_minor: totalAmount,
      covered_by_membership: covered.rowCount ?? 0,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
