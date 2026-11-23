CREATE OR REPLACE FUNCTION "recompute_usage_tier"(p_user uuid, p_reason text)
RETURNS "usage_tier" AS $$
DECLARE
  v_old "usage_tier";
  v_new "usage_tier";
  v_actions integer;
  v_spent bigint;
BEGIN
  SELECT "usage_tier" INTO v_old FROM "user_account" WHERE "id" = p_user FOR NO KEY UPDATE;
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
