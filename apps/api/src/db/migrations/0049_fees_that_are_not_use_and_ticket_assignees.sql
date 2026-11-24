CREATE OR REPLACE FUNCTION "usage_tier_counts"(p_user uuid)
RETURNS TABLE ("actions" integer, "spent_minor" bigint) AS $$
  WITH since AS (
    SELECT (((now() AT TIME ZONE 'UTC')::date - 90)::timestamp AT TIME ZONE 'UTC') AS t
  ),
  counted AS (
    SELECT c."amount"
      FROM "charge" c, since
     WHERE c."user_id" = p_user
       AND c."status" = 'settled'
       AND c."amount" > 0
       AND c."created_at" >= since.t
       AND c."action_type" NOT LIKE 'membership:%'
       AND c."action_type" NOT IN ('cash_out_fee', 'chargeback_fee', 'shipping_restocking_fee')
       AND COALESCE(c."pricing_rule_snapshot" ->> 'chargebackFee', 'false') <> 'true'
       AND COALESCE(c."pricing_rule_snapshot" ->> 'cashOutFee', 'false') <> 'true'
    UNION ALL
    SELECT l."amount"
      FROM "ledger_record" l, since
     WHERE l."user_id" = p_user
       AND l."type"::text = 'fee'
       AND l."direction"::text = 'debit'
       AND l."reference_type" IN ('listing', 'service_request')
       AND l."occurred_at" >= since.t
       AND NOT EXISTS (
         SELECT 1 FROM "ledger_record" r
          WHERE r."user_id" = l."user_id"
            AND r."type"::text = 'service_refund'
            AND r."direction"::text = 'credit'
            AND r."reference_type" = l."reference_type"
            AND r."reference_id" = l."reference_id")
    UNION ALL
    SELECT h."price"
      FROM "house_order" h, since
     WHERE h."buyer_id" = p_user
       AND h."created_at" >= since.t
  )
  SELECT count(*)::int, COALESCE(sum("amount"), 0)::bigint FROM counted;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
SELECT "recompute_usage_tier"("id", 'migration') FROM "user_account";
--> statement-breakpoint
UPDATE "support_ticket" t
   SET "assigned_to" = NULL
 WHERE t."assigned_to" IS NOT NULL
   AND (t."assigned_to" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR NOT EXISTS (SELECT 1 FROM "user_account" u WHERE u."id"::text = lower(t."assigned_to")));
--> statement-breakpoint
ALTER TABLE "support_ticket"
  ALTER COLUMN "assigned_to" SET DATA TYPE uuid USING "assigned_to"::uuid;
--> statement-breakpoint
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_assigned_to_user_account_id_fk"
  FOREIGN KEY ("assigned_to") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "support_ticket" VALIDATE CONSTRAINT "support_ticket_assigned_to_user_account_id_fk";
