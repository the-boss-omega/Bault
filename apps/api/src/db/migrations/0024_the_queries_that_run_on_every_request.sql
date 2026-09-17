-- =============================================================================
-- 0024 — THE QUERIES THAT RUN ON EVERY REQUEST
--
-- The schema had 34 indexes and the ones that existed were well chosen. What was
-- missing were the lookups on the hot paths — the ones nobody writes a query for
-- because they are performed by a guard, a join or a worker rather than by a
-- page.
--
-- The worst of them: `login_session.token_hash` had no index at all, and
-- `SessionService.verify` matches on it for EVERY authenticated request. With a
-- seven-day TTL and no cleanup, that table only grows, so the cost of being
-- signed in grew with the number of people who had ever signed in.
--
-- CONCURRENTLY is deliberately NOT used. These run inside the migration runner's
-- transaction, the tables are small today, and a brief lock now is cheaper than
-- a migration that cannot be run in a transaction at all. Revisit if any of
-- these tables reaches a size where the lock matters.
-- =============================================================================

-- 1. THE SESSION LOOKUP. Every authenticated request.
--    Partial on `revoked_at IS NULL` because that is the only row set `verify`
--    ever wants, and it keeps the index small as revoked sessions accumulate.
CREATE INDEX IF NOT EXISTS "login_session_token_active_idx"
  ON "login_session" ("token_hash") WHERE "revoked_at" IS NULL;--> statement-breakpoint

-- Sweeping expired sessions, and revoking every session a user holds — which
-- password change and reset now do.
CREATE INDEX IF NOT EXISTS "login_session_user_idx"
  ON "login_session" ("user_id", "expires_at");--> statement-breakpoint

-- 2. THE VAULT. `item.owner_id` was unindexed, so every vault page load and
--    every ownership check scanned the item table.
CREATE INDEX IF NOT EXISTS "item_owner_idx"
  ON "item" ("owner_id", "created_at");--> statement-breakpoint

-- 3. THE CUSTODY TRAIL. One item's history, and the shelving ledger for it.
--    Both are read by the item detail panel and by every audit answer.
CREATE INDEX IF NOT EXISTS "custody_event_item_idx"
  ON "custody_event" ("item_id", "occurred_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bin_transfer_item_idx"
  ON "bin_transfer" ("item_id", "occurred_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "item_change_history_item_idx"
  ON "item_change_history" ("item_id", "created_at");--> statement-breakpoint

-- 4. PHOTOGRAPHS. Read for every item that has one, which after the intake
--    bench is most of them.
CREATE INDEX IF NOT EXISTS "item_image_item_idx"
  ON "item_image" ("item_id", "version");--> statement-breakpoint

-- 5. THE OUTBOX. The worker asks for undispatched rows every 60 seconds,
--    forever. Partial, so the index covers the backlog rather than the history:
--    a dispatched row leaves the index instead of growing it.
CREATE INDEX IF NOT EXISTS "outbox_undispatched_idx"
  ON "outbox_message" ("created_at") WHERE "dispatched_at" IS NULL;--> statement-breakpoint

-- 6. MONEY AND AUDIT. A collector's charges, and "what did this actor do".
CREATE INDEX IF NOT EXISTS "charge_user_created_idx"
  ON "charge" ("user_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_record_actor_idx"
  ON "audit_record" ("actor_id", "occurred_at");--> statement-breakpoint

-- 7. VERIFICATION AND RESET TOKENS. Matched by hash on every click of a link in
--    an email, and swept for expiry.
CREATE INDEX IF NOT EXISTS "verification_token_hash_idx"
  ON "verification_token" ("token_hash");
