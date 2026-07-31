import type { Pool } from 'pg';

/**
 * Automatic storage-fee billing (Requirement 12.1).
 *
 * Every account holding items that have been stored for MORE THAN ONE DAY is
 * charged, automatically, once per day. There is no manual "charge" action
 * anywhere in the platform (Requirement 12.2) — this scheduled sweep is the only
 * producer of storage charges.
 *
 * Everything commits in ONE transaction: a settled `charge` per item carrying the
 * pricing-rule snapshot in force at run time (price freeze), the matching
 * append-only ledger debit, and the `storage_fee_run` audit row.
 *
 * Idempotent per day: if a sweep already ran since midnight UTC the job exits
 * without charging, so a worker restart (or a re-queued job) never double-bills.
 */
const THRESHOLD_DAYS = 1;

export async function runStorageFees(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Guard: at most one sweep per calendar day (UTC). FOR UPDATE is unnecessary —
    // the insert below is the only writer, and it happens inside this transaction.
    const already = await client.query(
      `SELECT 1 FROM storage_fee_run WHERE run_at >= date_trunc('day', now()) LIMIT 1`,
    );
    if ((already.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      // eslint-disable-next-line no-console
      console.log('[job:storage-fee] already billed today — skipping');
      return;
    }

    // The storage rule in force right now (effective-dated; newest wins).
    const ruleResult = await client.query<{
      id: string;
      action_type: string;
      item_class: string | null;
      model: string;
      value: string;
      currency: string;
      effective_from: Date;
    }>(
      `SELECT id, action_type, item_class, model, value, currency, effective_from
       FROM pricing_rule
       WHERE action_type = 'storage'
         AND effective_from <= now()
         AND (effective_to IS NULL OR effective_to > now())
       ORDER BY item_class NULLS LAST, effective_from DESC
       LIMIT 1`,
    );
    const rule = ruleResult.rows[0];
    if (!rule) {
      await client.query('ROLLBACK');
      // eslint-disable-next-line no-console
      console.warn('[job:storage-fee] no storage pricing rule in force — nothing billed');
      return;
    }
    if (rule.model !== 'fixed') {
      await client.query('ROLLBACK');
      // eslint-disable-next-line no-console
      console.warn(`[job:storage-fee] storage rule model "${rule.model}" is not billable per item`);
      return;
    }
    const perItem = Number(rule.value);
    const snapshot = {
      ruleId: rule.id,
      actionType: rule.action_type,
      itemClass: rule.item_class,
      model: rule.model,
      value: perItem,
      currency: rule.currency,
      effectiveFrom: rule.effective_from,
    };

    // Charge one row per stored item received more than THRESHOLD_DAYS ago, then
    // mirror each charge as a ledger debit via the charge's own id.
    const charged = await client.query<{ id: string; user_id: string; reference_id: string }>(
      `WITH due AS (
         SELECT id, owner_id
         FROM item
         WHERE lifecycle_state = 'stored'
           AND received_at < now() - make_interval(days => $1::int)
       )
       INSERT INTO charge (user_id, action_type, pricing_rule_snapshot, amount, currency, payment_means, status, reference_id)
       SELECT due.owner_id, 'storage', $2::jsonb, $3::bigint, $4, 'wallet', 'settled', due.id
       FROM due
       RETURNING id, user_id, reference_id`,
      [THRESHOLD_DAYS, JSON.stringify(snapshot), perItem, rule.currency],
    );

    if (charged.rowCount && charged.rowCount > 0) {
      await client.query(
        `INSERT INTO ledger_record (user_id, type, amount, direction, currency, reference_type, reference_id)
         SELECT c.user_id, 'service_charge', c.amount, 'debit', c.currency, 'charge', c.id
         FROM charge c
         WHERE c.id = ANY($1::uuid[])`,
        [charged.rows.map((r) => r.id)],
      );
    }

    const itemIds = charged.rows.map((r) => r.reference_id);
    const accountIds = [...new Set(charged.rows.map((r) => r.user_id))];
    await client.query(
      `INSERT INTO storage_fee_run
         (threshold_days, triggered_by, charged_item_ids, charged_account_ids, total_amount, currency)
       VALUES ($1::int, 'system', $2::jsonb, $3::jsonb, $4::bigint, $5)`,
      [
        THRESHOLD_DAYS,
        JSON.stringify(itemIds),
        JSON.stringify(accountIds),
        perItem * itemIds.length,
        rule.currency,
      ],
    );

    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log(
      `[job:storage-fee] charged ${itemIds.length} item(s) across ${accountIds.length} account(s)`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
