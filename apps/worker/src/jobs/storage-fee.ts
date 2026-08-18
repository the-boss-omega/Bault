import type { Pool } from 'pg';

/**
 * Automatic storage billing (Requirement 12.1).
 *
 * There is no manual "charge storage" action anywhere in the platform
 * (Requirement 12.2) — this scheduled sweep is the only producer of storage
 * charges.
 *
 * WHAT CHANGED, AND WHY
 *
 * This used to charge a flat per-item fee every day for every item stored more
 * than one day. It was simple and it was wrong in one important way: it charged
 * rent on a $1 common from the moment it landed, so a collector who left a bulk
 * lot alone for six months paid many times what the lot was worth.
 *
 * Storage is now an INCLUDED PERIOD folded into the intake fee, followed by
 * chargeable periods priced as a PROPORTION of that same intake fee — so what it
 * costs to keep something is tied to the value of the handling it needed:
 *
 *   standard    180 days included, then 10% of the item's own intake fee / 90 days
 *   oversized    90 days included, then 100% of the intake fee / 90 days
 *
 * Both parameter sets live in the `parameters` blob of their pricing rule
 * (`storage` and `storage_oversized`), so they are admin-editable data rather
 * than constants in this file (Principle VI).
 *
 * IDEMPOTENCE, PROPERLY
 *
 * The old guard was "at most one sweep per calendar day", which protected
 * against a double run but silently UNDER-billed whenever a day was missed: the
 * skipped day's fee was simply never charged.
 *
 * The guard is now period accounting. For each item the sweep works out how many
 * periods have elapsed and subtracts how many storage charges already exist
 * against it; it bills the difference. Running twice in one day bills nothing the
 * second time, because the count already matches. Missing a week bills the
 * catch-up when it next runs. The ledger, not the clock, is the record of what
 * has been charged.
 *
 * WHY THIS IS SQL
 *
 * It is a set operation over every stored item, and the correctness of the guard
 * depends on counting existing charges and inserting in the same statement. Doing
 * it in application code would mean a read-then-write race that the period count
 * is specifically designed to avoid. The API's `storage-policy.ts` deliberately
 * does NOT duplicate this calculation — it reads what this sweep wrote.
 */
export async function runStorageFees(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /**
     * Both rule variants, with their parameters. An item picks its row by its
     * own `oversized` flag, which was fixed at intake.
     */
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
      // eslint-disable-next-line no-console
      console.warn('[job:storage-fee] no storage pricing rule in force — nothing billed');
      return;
    }
    // An oversized rule is optional: without one, oversized items simply fall
    // under the standard terms rather than escaping billing altogether.
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

    /**
     * One row per (item, period) that is due and not yet billed.
     *
     * `intake_minor` is the item's own intake charge — the base the percentage
     * applies to. An item with no intake charge (seeded or hand-created before
     * billing existed) falls back to the rule's flat `value`, so it is still
     * billed something rather than being stored free forever by accident.
     *
     * `periods_billed` counts the storage charges already raised against the
     * item. That count IS the idempotence guard.
     */
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
       stored AS (
         SELECT i.id,
                i.owner_id,
                i.oversized,
                i.received_at,
                COALESCE(
                  (SELECT c.amount FROM charge c
                    WHERE c.action_type = 'intake' AND c.reference_id = i.id::text
                    ORDER BY c.created_at DESC LIMIT 1),
                  CASE WHEN i.oversized THEN (SELECT ovr_flat FROM policy)
                       ELSE (SELECT std_flat FROM policy) END
                ) AS intake_minor,
                (SELECT count(*) FROM charge c
                  WHERE c.action_type IN ('storage', 'storage_oversized')
                    AND c.reference_id = i.id::text) AS periods_billed
           FROM item i
          WHERE i.lifecycle_state = 'stored'
            AND i.received_at IS NOT NULL
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
                s.received_at
           FROM stored s CROSS JOIN policy p
       ),
       elapsed AS (
         SELECT c.*,
                -- Periods that have STARTED since the included window closed.
                -- floor(days_past_free / period) + 1, never below zero.
                GREATEST(
                  0,
                  FLOOR(
                    EXTRACT(EPOCH FROM (now() - (c.received_at + make_interval(days => c.free_days))))
                    / (c.period_days * 86400.0)
                  )::int + 1
                ) AS periods_elapsed
           FROM computed c
          WHERE now() >= c.received_at + make_interval(days => c.free_days)
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

      // One charge row per PERIOD, not one lump for the catch-up. A collector
      // reading their ledger should see "3 storage periods" as three lines they
      // can count, and each carries the snapshot of the rule it was billed under.
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
    // eslint-disable-next-line no-console
    console.log(
      `[job:storage-fee] billed ${chargedCount} period(s) across ${itemIds.length} item(s) / ${accountIds.size} account(s), total ${totalAmount}`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
