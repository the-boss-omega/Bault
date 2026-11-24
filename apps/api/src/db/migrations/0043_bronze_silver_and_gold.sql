UPDATE "membership" SET "tier" = CASE "tier" WHEN 'folio' THEN 'bronze' WHEN 'registry' THEN 'silver' WHEN 'trust' THEN 'gold' END WHERE "tier" IN ('folio', 'registry', 'trust');
--> statement-breakpoint
UPDATE "membership" SET "scheduled_tier" = CASE "scheduled_tier" WHEN 'folio' THEN 'bronze' WHEN 'registry' THEN 'silver' WHEN 'trust' THEN 'gold' END WHERE "scheduled_tier" IN ('folio', 'registry', 'trust');
--> statement-breakpoint
UPDATE "membership_period" SET "tier" = CASE "tier" WHEN 'folio' THEN 'bronze' WHEN 'registry' THEN 'silver' WHEN 'trust' THEN 'gold' END WHERE "tier" IN ('folio', 'registry', 'trust');
--> statement-breakpoint
UPDATE "membership_period"
   SET "pricing_rule_snapshot" = jsonb_set("pricing_rule_snapshot", '{actionType}', to_jsonb(CASE "pricing_rule_snapshot" ->> 'actionType' WHEN 'membership:folio' THEN 'membership:bronze' WHEN 'membership:registry' THEN 'membership:silver' WHEN 'membership:trust' THEN 'membership:gold' END))
 WHERE "pricing_rule_snapshot" ->> 'actionType' IN ('membership:folio', 'membership:registry', 'membership:trust');
--> statement-breakpoint
UPDATE "membership_period"
   SET "pricing_rule_snapshot" = jsonb_set("pricing_rule_snapshot", '{tier}', to_jsonb(CASE "pricing_rule_snapshot" ->> 'tier' WHEN 'folio' THEN 'bronze' WHEN 'registry' THEN 'silver' WHEN 'trust' THEN 'gold' END))
 WHERE "pricing_rule_snapshot" ->> 'tier' IN ('folio', 'registry', 'trust');
--> statement-breakpoint
UPDATE "charge"
   SET "pricing_rule_snapshot" = jsonb_set("pricing_rule_snapshot", '{actionType}', to_jsonb(CASE "pricing_rule_snapshot" ->> 'actionType' WHEN 'membership:folio' THEN 'membership:bronze' WHEN 'membership:registry' THEN 'membership:silver' WHEN 'membership:trust' THEN 'membership:gold' END))
 WHERE "pricing_rule_snapshot" ->> 'actionType' IN ('membership:folio', 'membership:registry', 'membership:trust');
--> statement-breakpoint
UPDATE "charge"
   SET "pricing_rule_snapshot" = jsonb_set("pricing_rule_snapshot", '{tier}', to_jsonb(CASE "pricing_rule_snapshot" ->> 'tier' WHEN 'folio' THEN 'bronze' WHEN 'registry' THEN 'silver' WHEN 'trust' THEN 'gold' END))
 WHERE "pricing_rule_snapshot" ->> 'tier' IN ('folio', 'registry', 'trust');
--> statement-breakpoint
UPDATE "charge"
   SET "pricing_rule_snapshot" = jsonb_set("pricing_rule_snapshot", '{membershipWaiver,tier}', to_jsonb(CASE "pricing_rule_snapshot" -> 'membershipWaiver' ->> 'tier' WHEN 'folio' THEN 'bronze' WHEN 'registry' THEN 'silver' WHEN 'trust' THEN 'gold' END))
 WHERE "pricing_rule_snapshot" -> 'membershipWaiver' ->> 'tier' IN ('folio', 'registry', 'trust');
--> statement-breakpoint
UPDATE "transaction"
   SET "frozen_pricing" = jsonb_set("frozen_pricing", '{membershipWaiver,tier}', to_jsonb(CASE "frozen_pricing" -> 'membershipWaiver' ->> 'tier' WHEN 'folio' THEN 'bronze' WHEN 'registry' THEN 'silver' WHEN 'trust' THEN 'gold' END))
 WHERE "frozen_pricing" -> 'membershipWaiver' ->> 'tier' IN ('folio', 'registry', 'trust');
--> statement-breakpoint
UPDATE "charge" SET "action_type" = CASE "action_type" WHEN 'membership:folio' THEN 'membership:bronze' WHEN 'membership:registry' THEN 'membership:silver' WHEN 'membership:trust' THEN 'membership:gold' END WHERE "action_type" IN ('membership:folio', 'membership:registry', 'membership:trust');
--> statement-breakpoint
UPDATE "pricing_rule"
   SET "action_type" = CASE "action_type" WHEN 'membership:folio' THEN 'membership:bronze' WHEN 'membership:registry' THEN 'membership:silver' WHEN 'membership:trust' THEN 'membership:gold' END,
       "description" = CASE
         WHEN "description" LIKE 'Folio membership%' THEN 'Bronze' || substr("description", 6)
         WHEN "description" LIKE 'Registry membership%' THEN 'Silver' || substr("description", 9)
         WHEN "description" LIKE 'Trust membership%' THEN 'Gold' || substr("description", 6)
         ELSE "description"
       END
 WHERE "action_type" IN ('membership:folio', 'membership:registry', 'membership:trust');
--> statement-breakpoint
UPDATE "shipment"
   SET "membership_cover" = jsonb_set("membership_cover", '{tier}', to_jsonb(CASE "membership_cover" ->> 'tier' WHEN 'folio' THEN 'bronze' WHEN 'registry' THEN 'silver' WHEN 'trust' THEN 'gold' END))
 WHERE "membership_cover" ->> 'tier' IN ('folio', 'registry', 'trust');
