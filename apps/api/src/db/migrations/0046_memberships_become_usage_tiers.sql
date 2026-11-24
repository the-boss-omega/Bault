DO $$ BEGIN
  CREATE TYPE "usage_tier" AS ENUM ('bronze', 'silver', 'gold');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN IF NOT EXISTS "usage_tier" "usage_tier" DEFAULT 'bronze' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_account" ADD COLUMN IF NOT EXISTS "usage_tier_computed_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_tier_rule" (
  "tier" "usage_tier" PRIMARY KEY NOT NULL,
  "min_actions" integer NOT NULL,
  "min_spent_minor" bigint NOT NULL,
  "discount_bps" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "usage_tier_rule_sane" CHECK ("min_actions" >= 0 AND "min_spent_minor" >= 0 AND "discount_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
INSERT INTO "usage_tier_rule" ("tier", "min_actions", "min_spent_minor", "discount_bps") VALUES
  ('bronze', 0, 0, 0),
  ('silver', 10, 50000, 1000),
  ('gold', 30, 200000, 2000)
ON CONFLICT ("tier") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_tier_change" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user_account"("id") ON DELETE restrict,
  "from_tier" "usage_tier" NOT NULL,
  "to_tier" "usage_tier" NOT NULL,
  "actions" integer NOT NULL,
  "spent_minor" bigint NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_tier_change_user_idx" ON "usage_tier_change" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "charge_user_created_idx" ON "charge" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "house_order_buyer_created_idx" ON "house_order" ("buyer_id", "created_at");
--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN IF NOT EXISTS "honoured_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "membership" ADD COLUMN IF NOT EXISTS "honoured_stored_items" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "membership" m
   SET "honoured_until" = m."current_period_end",
       "honoured_stored_items" = COALESCE(
         (SELECT (pr."parameters" ->> 'storedItems')::int
            FROM "pricing_rule" pr
           WHERE pr."action_type" = 'membership:' || m."tier"
             AND pr."item_class" IS NULL
             AND pr."effective_from" <= now()
           ORDER BY pr."effective_from" DESC
           LIMIT 1),
         CASE m."tier" WHEN 'bronze' THEN 60 WHEN 'silver' THEN 200 WHEN 'gold' THEN 750 ELSE 0 END),
       "scheduled_tier" = NULL,
       "updated_at" = now()
 WHERE m."status" <> 'ended' AND m."honoured_until" IS NULL;
--> statement-breakpoint
UPDATE "pricing_rule"
   SET "effective_to" = GREATEST(now(), "effective_from")
 WHERE "action_type" LIKE 'membership:%'
   AND ("effective_to" IS NULL OR "effective_to" > now());
--> statement-breakpoint
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
       AND COALESCE(c."pricing_rule_snapshot" ->> 'chargebackFee', 'false') <> 'true'
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
CREATE OR REPLACE FUNCTION "recompute_usage_tier"(p_user uuid, p_reason text)
RETURNS "usage_tier" AS $$
DECLARE
  v_old "usage_tier";
  v_new "usage_tier";
  v_actions integer;
  v_spent bigint;
BEGIN
  SELECT "usage_tier" INTO v_old FROM "user_account" WHERE "id" = p_user;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT "actions", "spent_minor" INTO v_actions, v_spent FROM "usage_tier_counts"(p_user);
  SELECT "tier" INTO v_new
    FROM "usage_tier_rule"
   WHERE v_actions >= "min_actions" OR v_spent >= "min_spent_minor"
   ORDER BY "tier" DESC
   LIMIT 1;
  v_new := COALESCE(v_new, 'bronze');
  IF v_new = v_old THEN
    IF p_reason <> 'charge' THEN
      UPDATE "user_account" SET "usage_tier_computed_at" = now() WHERE "id" = p_user;
    END IF;
    RETURN v_new;
  END IF;
  UPDATE "user_account"
     SET "usage_tier" = v_new, "usage_tier_computed_at" = now()
   WHERE "id" = p_user AND "usage_tier" = v_old;
  IF FOUND THEN
    INSERT INTO "usage_tier_change" ("user_id", "from_tier", "to_tier", "actions", "spent_minor", "reason")
    VALUES (p_user, v_old, v_new, v_actions, v_spent, p_reason);
  END IF;
  RETURN v_new;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "usage_tier_after_charge"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'settled' OR TG_OP = 'UPDATE' THEN
    PERFORM "recompute_usage_tier"(NEW."user_id", 'charge');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "charge_usage_tier_insert" ON "charge";
--> statement-breakpoint
CREATE TRIGGER "charge_usage_tier_insert"
  AFTER INSERT ON "charge"
  FOR EACH ROW EXECUTE FUNCTION "usage_tier_after_charge"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "charge_usage_tier_status" ON "charge";
--> statement-breakpoint
CREATE TRIGGER "charge_usage_tier_status"
  AFTER UPDATE OF "status" ON "charge"
  FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION "usage_tier_after_charge"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "usage_tier_after_fee"() RETURNS trigger AS $$
BEGIN
  PERFORM "recompute_usage_tier"(NEW."user_id", 'charge');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ledger_record_usage_tier" ON "ledger_record";
--> statement-breakpoint
CREATE TRIGGER "ledger_record_usage_tier"
  AFTER INSERT ON "ledger_record"
  FOR EACH ROW
  WHEN (NEW."type"::text IN ('fee', 'service_refund') AND NEW."reference_type" IN ('listing', 'service_request'))
  EXECUTE FUNCTION "usage_tier_after_fee"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "usage_tier_after_house_order"() RETURNS trigger AS $$
BEGIN
  PERFORM "recompute_usage_tier"(NEW."buyer_id", 'charge');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "house_order_usage_tier" ON "house_order";
--> statement-breakpoint
CREATE TRIGGER "house_order_usage_tier"
  AFTER INSERT ON "house_order"
  FOR EACH ROW EXECUTE FUNCTION "usage_tier_after_house_order"();
--> statement-breakpoint
SELECT "recompute_usage_tier"("id", 'migration') FROM "user_account";
