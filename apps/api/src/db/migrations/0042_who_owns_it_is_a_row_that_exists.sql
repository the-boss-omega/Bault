ALTER TABLE "verification_token"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "login_session"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "login_attempt"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "mfa_factor"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "mfa_email_code"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "mfa_recovery_code"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "mfa_challenge"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "shipping_address"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "confirmation_token"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "idempotency_key"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "notification"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "notification_preference"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "audit_record"
  ALTER COLUMN "actor_id" SET DATA TYPE uuid USING "actor_id"::uuid;
--> statement-breakpoint
ALTER TABLE "media_upload"
  ALTER COLUMN "uploaded_by" SET DATA TYPE uuid USING "uploaded_by"::uuid;
--> statement-breakpoint
ALTER TABLE "pricing_rule"
  ALTER COLUMN "updated_by" SET DATA TYPE uuid USING "updated_by"::uuid;
--> statement-breakpoint
ALTER TABLE "ledger_record"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "external_payment"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "charge"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "withdrawal"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;
--> statement-breakpoint
ALTER TABLE "wallet_request"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid,
  ALTER COLUMN "reviewed_by" SET DATA TYPE uuid USING "reviewed_by"::uuid,
  ALTER COLUMN "settled_ledger_id" SET DATA TYPE uuid USING "settled_ledger_id"::uuid,
  ALTER COLUMN "payout_payment_id" SET DATA TYPE uuid USING "payout_payment_id"::uuid;
--> statement-breakpoint
ALTER TABLE "wallet_request_event"
  ALTER COLUMN "request_id" SET DATA TYPE uuid USING "request_id"::uuid,
  ALTER COLUMN "actor_id" SET DATA TYPE uuid USING "actor_id"::uuid;
--> statement-breakpoint
ALTER TABLE "batch"
  ALTER COLUMN "owner_id" SET DATA TYPE uuid USING "owner_id"::uuid;
--> statement-breakpoint
ALTER TABLE "item"
  ALTER COLUMN "owner_id" SET DATA TYPE uuid USING "owner_id"::uuid,
  ALTER COLUMN "source_batch_id" SET DATA TYPE uuid USING "source_batch_id"::uuid,
  ALTER COLUMN "source_parcel_id" SET DATA TYPE uuid USING "source_parcel_id"::uuid;
--> statement-breakpoint
ALTER TABLE "item_image"
  ALTER COLUMN "item_id" SET DATA TYPE uuid USING "item_id"::uuid;
--> statement-breakpoint
ALTER TABLE "item_change_history"
  ALTER COLUMN "item_id" SET DATA TYPE uuid USING "item_id"::uuid,
  ALTER COLUMN "actor_id" SET DATA TYPE uuid USING "actor_id"::uuid;
--> statement-breakpoint
ALTER TABLE "bin_transfer"
  ALTER COLUMN "item_id" SET DATA TYPE uuid USING "item_id"::uuid,
  ALTER COLUMN "actor_id" SET DATA TYPE uuid USING "actor_id"::uuid;
--> statement-breakpoint
ALTER TABLE "custody_event"
  ALTER COLUMN "item_id" SET DATA TYPE uuid USING "item_id"::uuid,
  ALTER COLUMN "prev_owner_id" SET DATA TYPE uuid USING "prev_owner_id"::uuid,
  ALTER COLUMN "new_owner_id" SET DATA TYPE uuid USING "new_owner_id"::uuid,
  ALTER COLUMN "actor_id" SET DATA TYPE uuid USING "actor_id"::uuid;
--> statement-breakpoint
ALTER TABLE "bin"
  ALTER COLUMN "facility_id" SET DATA TYPE uuid USING "facility_id"::uuid;
--> statement-breakpoint
ALTER TABLE "facility"
  ALTER COLUMN "forwards_to_facility_id" SET DATA TYPE uuid USING "forwards_to_facility_id"::uuid;
--> statement-breakpoint
ALTER TABLE "parcel"
  ALTER COLUMN "owner_id" SET DATA TYPE uuid USING "owner_id"::uuid,
  ALTER COLUMN "facility_id" SET DATA TYPE uuid USING "facility_id"::uuid,
  ALTER COLUMN "forwarded_from_facility_id" SET DATA TYPE uuid USING "forwarded_from_facility_id"::uuid,
  ALTER COLUMN "received_by" SET DATA TYPE uuid USING "received_by"::uuid,
  ALTER COLUMN "opened_by" SET DATA TYPE uuid USING "opened_by"::uuid;
--> statement-breakpoint
ALTER TABLE "parcel_event"
  ALTER COLUMN "parcel_id" SET DATA TYPE uuid USING "parcel_id"::uuid,
  ALTER COLUMN "actor_id" SET DATA TYPE uuid USING "actor_id"::uuid,
  ALTER COLUMN "facility_id" SET DATA TYPE uuid USING "facility_id"::uuid;
--> statement-breakpoint
ALTER TABLE "parcel_photo"
  ALTER COLUMN "parcel_id" SET DATA TYPE uuid USING "parcel_id"::uuid,
  ALTER COLUMN "uploaded_by" SET DATA TYPE uuid USING "uploaded_by"::uuid;
--> statement-breakpoint
ALTER TABLE "arrival_disposal"
  ALTER COLUMN "owner_id" SET DATA TYPE uuid USING "owner_id"::uuid,
  ALTER COLUMN "actor_id" SET DATA TYPE uuid USING "actor_id"::uuid;
--> statement-breakpoint
ALTER TABLE "listing"
  ALTER COLUMN "item_id" SET DATA TYPE uuid USING "item_id"::uuid,
  ALTER COLUMN "seller_id" SET DATA TYPE uuid USING "seller_id"::uuid;
--> statement-breakpoint
ALTER TABLE "transaction"
  ALTER COLUMN "buyer_id" SET DATA TYPE uuid USING "buyer_id"::uuid,
  ALTER COLUMN "seller_id" SET DATA TYPE uuid USING "seller_id"::uuid;
--> statement-breakpoint
ALTER TABLE "offer"
  ALTER COLUMN "listing_id" SET DATA TYPE uuid USING "listing_id"::uuid,
  ALTER COLUMN "buyer_id" SET DATA TYPE uuid USING "buyer_id"::uuid,
  ALTER COLUMN "parent_offer_id" SET DATA TYPE uuid USING "parent_offer_id"::uuid;
--> statement-breakpoint
ALTER TABLE "swap_proposal"
  ALTER COLUMN "proposer_id" SET DATA TYPE uuid USING "proposer_id"::uuid,
  ALTER COLUMN "responder_id" SET DATA TYPE uuid USING "responder_id"::uuid;
--> statement-breakpoint
ALTER TABLE "house_listing"
  ALTER COLUMN "created_by" SET DATA TYPE uuid USING "created_by"::uuid;
--> statement-breakpoint
ALTER TABLE "house_order"
  ALTER COLUMN "buyer_id" SET DATA TYPE uuid USING "buyer_id"::uuid,
  ALTER COLUMN "item_id" SET DATA TYPE uuid USING "item_id"::uuid,
  ALTER COLUMN "transaction_id" SET DATA TYPE uuid USING "transaction_id"::uuid,
  ALTER COLUMN "stowed_by" SET DATA TYPE uuid USING "stowed_by"::uuid;
--> statement-breakpoint
ALTER TABLE "dispute"
  ALTER COLUMN "transaction_id" SET DATA TYPE uuid USING "transaction_id"::uuid,
  ALTER COLUMN "opened_by" SET DATA TYPE uuid USING "opened_by"::uuid,
  ALTER COLUMN "assigned_admin_id" SET DATA TYPE uuid USING "assigned_admin_id"::uuid;
--> statement-breakpoint
ALTER TABLE "service_request"
  ALTER COLUMN "requester_id" SET DATA TYPE uuid USING "requester_id"::uuid,
  ALTER COLUMN "item_id" SET DATA TYPE uuid USING "item_id"::uuid,
  ALTER COLUMN "batch_id" SET DATA TYPE uuid USING "batch_id"::uuid,
  ALTER COLUMN "charge_id" SET DATA TYPE uuid USING "charge_id"::uuid,
  ALTER COLUMN "fulfilled_by" SET DATA TYPE uuid USING "fulfilled_by"::uuid;
--> statement-breakpoint
ALTER TABLE "support_ticket"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid,
  ALTER COLUMN "resolved_by" SET DATA TYPE uuid USING "resolved_by"::uuid;
--> statement-breakpoint
ALTER TABLE "support_message"
  ALTER COLUMN "ticket_id" SET DATA TYPE uuid USING "ticket_id"::uuid,
  ALTER COLUMN "author_id" SET DATA TYPE uuid USING "author_id"::uuid;
--> statement-breakpoint
ALTER TABLE "shipment"
  ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid,
  ALTER COLUMN "fulfilled_by" SET DATA TYPE uuid USING "fulfilled_by"::uuid,
  ALTER COLUMN "merged_into_shipment_id" SET DATA TYPE uuid USING "merged_into_shipment_id"::uuid,
  ALTER COLUMN "group_id" SET DATA TYPE uuid USING "group_id"::uuid;
--> statement-breakpoint
ALTER TABLE "verification_token" ADD CONSTRAINT "verification_token_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "login_session" ADD CONSTRAINT "login_session_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "mfa_factor" ADD CONSTRAINT "mfa_factor_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "mfa_email_code" ADD CONSTRAINT "mfa_email_code_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "mfa_challenge" ADD CONSTRAINT "mfa_challenge_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "shipping_address" ADD CONSTRAINT "shipping_address_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "confirmation_token" ADD CONSTRAINT "confirmation_token_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "audit_record" ADD CONSTRAINT "audit_record_actor_id_user_account_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "media_upload" ADD CONSTRAINT "media_upload_uploaded_by_user_account_id_fk"
  FOREIGN KEY ("uploaded_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "pricing_rule" ADD CONSTRAINT "pricing_rule_updated_by_user_account_id_fk"
  FOREIGN KEY ("updated_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "ledger_record" ADD CONSTRAINT "ledger_record_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "external_payment" ADD CONSTRAINT "external_payment_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "wallet_request" ADD CONSTRAINT "wallet_request_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "wallet_request" ADD CONSTRAINT "wallet_request_reviewed_by_user_account_id_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "wallet_request" ADD CONSTRAINT "wallet_request_settled_ledger_id_ledger_record_id_fk"
  FOREIGN KEY ("settled_ledger_id") REFERENCES "public"."ledger_record"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "wallet_request" ADD CONSTRAINT "wallet_request_payout_payment_id_external_payment_id_fk"
  FOREIGN KEY ("payout_payment_id") REFERENCES "public"."external_payment"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "wallet_request_event" ADD CONSTRAINT "wallet_request_event_request_id_wallet_request_id_fk"
  FOREIGN KEY ("request_id") REFERENCES "public"."wallet_request"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "wallet_request_event" ADD CONSTRAINT "wallet_request_event_actor_id_user_account_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "membership_period" ADD CONSTRAINT "membership_period_membership_id_membership_id_fk"
  FOREIGN KEY ("membership_id") REFERENCES "public"."membership"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "membership_period" ADD CONSTRAINT "membership_period_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_owner_id_user_account_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_owner_id_user_account_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_source_batch_id_batch_id_fk"
  FOREIGN KEY ("source_batch_id") REFERENCES "public"."batch"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_source_parcel_id_parcel_id_fk"
  FOREIGN KEY ("source_parcel_id") REFERENCES "public"."parcel"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "item_image" ADD CONSTRAINT "item_image_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "item_change_history" ADD CONSTRAINT "item_change_history_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "item_change_history" ADD CONSTRAINT "item_change_history_actor_id_user_account_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "bin_transfer" ADD CONSTRAINT "bin_transfer_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "bin_transfer" ADD CONSTRAINT "bin_transfer_actor_id_user_account_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "custody_event" ADD CONSTRAINT "custody_event_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "custody_event" ADD CONSTRAINT "custody_event_prev_owner_id_user_account_id_fk"
  FOREIGN KEY ("prev_owner_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "custody_event" ADD CONSTRAINT "custody_event_new_owner_id_user_account_id_fk"
  FOREIGN KEY ("new_owner_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "custody_event" ADD CONSTRAINT "custody_event_actor_id_user_account_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "storage_cover" ADD CONSTRAINT "storage_cover_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "bin" ADD CONSTRAINT "bin_facility_id_facility_id_fk"
  FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "facility" ADD CONSTRAINT "facility_forwards_to_facility_id_facility_id_fk"
  FOREIGN KEY ("forwards_to_facility_id") REFERENCES "public"."facility"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel" ADD CONSTRAINT "parcel_owner_id_user_account_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel" ADD CONSTRAINT "parcel_facility_id_facility_id_fk"
  FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel" ADD CONSTRAINT "parcel_forwarded_from_facility_id_facility_id_fk"
  FOREIGN KEY ("forwarded_from_facility_id") REFERENCES "public"."facility"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel" ADD CONSTRAINT "parcel_received_by_user_account_id_fk"
  FOREIGN KEY ("received_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel" ADD CONSTRAINT "parcel_opened_by_user_account_id_fk"
  FOREIGN KEY ("opened_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel_event" ADD CONSTRAINT "parcel_event_parcel_id_parcel_id_fk"
  FOREIGN KEY ("parcel_id") REFERENCES "public"."parcel"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel_event" ADD CONSTRAINT "parcel_event_actor_id_user_account_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel_event" ADD CONSTRAINT "parcel_event_facility_id_facility_id_fk"
  FOREIGN KEY ("facility_id") REFERENCES "public"."facility"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel_photo" ADD CONSTRAINT "parcel_photo_parcel_id_parcel_id_fk"
  FOREIGN KEY ("parcel_id") REFERENCES "public"."parcel"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "parcel_photo" ADD CONSTRAINT "parcel_photo_uploaded_by_user_account_id_fk"
  FOREIGN KEY ("uploaded_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "arrival_disposal" ADD CONSTRAINT "arrival_disposal_owner_id_user_account_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "arrival_disposal" ADD CONSTRAINT "arrival_disposal_actor_id_user_account_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "listing" ADD CONSTRAINT "listing_seller_id_user_account_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_buyer_id_user_account_id_fk"
  FOREIGN KEY ("buyer_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_seller_id_user_account_id_fk"
  FOREIGN KEY ("seller_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_listing_id_listing_id_fk"
  FOREIGN KEY ("listing_id") REFERENCES "public"."listing"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_buyer_id_user_account_id_fk"
  FOREIGN KEY ("buyer_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "offer" ADD CONSTRAINT "offer_parent_offer_id_offer_id_fk"
  FOREIGN KEY ("parent_offer_id") REFERENCES "public"."offer"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "swap_proposal" ADD CONSTRAINT "swap_proposal_proposer_id_user_account_id_fk"
  FOREIGN KEY ("proposer_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "swap_proposal" ADD CONSTRAINT "swap_proposal_responder_id_user_account_id_fk"
  FOREIGN KEY ("responder_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "house_listing" ADD CONSTRAINT "house_listing_created_by_user_account_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "house_order" ADD CONSTRAINT "house_order_buyer_id_user_account_id_fk"
  FOREIGN KEY ("buyer_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "house_order" ADD CONSTRAINT "house_order_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "house_order" ADD CONSTRAINT "house_order_transaction_id_transaction_id_fk"
  FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "house_order" ADD CONSTRAINT "house_order_stowed_by_user_account_id_fk"
  FOREIGN KEY ("stowed_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_transaction_id_transaction_id_fk"
  FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_opened_by_user_account_id_fk"
  FOREIGN KEY ("opened_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_assigned_admin_id_user_account_id_fk"
  FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_requester_id_user_account_id_fk"
  FOREIGN KEY ("requester_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_batch_id_batch_id_fk"
  FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_charge_id_charge_id_fk"
  FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_fulfilled_by_user_account_id_fk"
  FOREIGN KEY ("fulfilled_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "escrow_deal" ADD CONSTRAINT "escrow_deal_funding_attested_by_user_account_id_fk"
  FOREIGN KEY ("funding_attested_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "escrow_deal" ADD CONSTRAINT "escrow_deal_item_id_item_id_fk"
  FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "escrow_deal" ADD CONSTRAINT "escrow_deal_inspected_by_user_account_id_fk"
  FOREIGN KEY ("inspected_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "escrow_deal" ADD CONSTRAINT "escrow_deal_buyer_release_attested_by_user_account_id_fk"
  FOREIGN KEY ("buyer_release_attested_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "escrow_deal" ADD CONSTRAINT "escrow_deal_seller_release_attested_by_user_account_id_fk"
  FOREIGN KEY ("seller_release_attested_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "escrow_event" ADD CONSTRAINT "escrow_event_actor_id_user_account_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_resolved_by_user_account_id_fk"
  FOREIGN KEY ("resolved_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_ticket_id_support_ticket_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "public"."support_ticket"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_author_id_user_account_id_fk"
  FOREIGN KEY ("author_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_user_id_user_account_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_quoted_by_user_account_id_fk"
  FOREIGN KEY ("quoted_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_handed_over_by_user_account_id_fk"
  FOREIGN KEY ("handed_over_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_fulfilled_by_user_account_id_fk"
  FOREIGN KEY ("fulfilled_by") REFERENCES "public"."user_account"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_pickup_event_id_consignment_event_id_fk"
  FOREIGN KEY ("pickup_event_id") REFERENCES "public"."consignment_event"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_merged_into_shipment_id_shipment_id_fk"
  FOREIGN KEY ("merged_into_shipment_id") REFERENCES "public"."shipment"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_group_id_shipment_group_id_fk"
  FOREIGN KEY ("group_id") REFERENCES "public"."shipment_group"("id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "verification_token" VALIDATE CONSTRAINT "verification_token_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "login_session" VALIDATE CONSTRAINT "login_session_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "login_attempt" VALIDATE CONSTRAINT "login_attempt_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "mfa_factor" VALIDATE CONSTRAINT "mfa_factor_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "mfa_email_code" VALIDATE CONSTRAINT "mfa_email_code_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "mfa_recovery_code" VALIDATE CONSTRAINT "mfa_recovery_code_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "mfa_challenge" VALIDATE CONSTRAINT "mfa_challenge_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "shipping_address" VALIDATE CONSTRAINT "shipping_address_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "confirmation_token" VALIDATE CONSTRAINT "confirmation_token_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "idempotency_key" VALIDATE CONSTRAINT "idempotency_key_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "notification" VALIDATE CONSTRAINT "notification_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_preference" VALIDATE CONSTRAINT "notification_preference_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_record" VALIDATE CONSTRAINT "audit_record_actor_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "media_upload" VALIDATE CONSTRAINT "media_upload_uploaded_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "pricing_rule" VALIDATE CONSTRAINT "pricing_rule_updated_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "ledger_record" VALIDATE CONSTRAINT "ledger_record_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "external_payment" VALIDATE CONSTRAINT "external_payment_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "charge" VALIDATE CONSTRAINT "charge_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "withdrawal" VALIDATE CONSTRAINT "withdrawal_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "wallet_request" VALIDATE CONSTRAINT "wallet_request_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "wallet_request" VALIDATE CONSTRAINT "wallet_request_reviewed_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "wallet_request" VALIDATE CONSTRAINT "wallet_request_settled_ledger_id_ledger_record_id_fk";
--> statement-breakpoint
ALTER TABLE "wallet_request" VALIDATE CONSTRAINT "wallet_request_payout_payment_id_external_payment_id_fk";
--> statement-breakpoint
ALTER TABLE "wallet_request_event" VALIDATE CONSTRAINT "wallet_request_event_request_id_wallet_request_id_fk";
--> statement-breakpoint
ALTER TABLE "wallet_request_event" VALIDATE CONSTRAINT "wallet_request_event_actor_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "membership" VALIDATE CONSTRAINT "membership_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "membership_period" VALIDATE CONSTRAINT "membership_period_membership_id_membership_id_fk";
--> statement-breakpoint
ALTER TABLE "membership_period" VALIDATE CONSTRAINT "membership_period_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "batch" VALIDATE CONSTRAINT "batch_owner_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "item" VALIDATE CONSTRAINT "item_owner_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "item" VALIDATE CONSTRAINT "item_source_batch_id_batch_id_fk";
--> statement-breakpoint
ALTER TABLE "item" VALIDATE CONSTRAINT "item_source_parcel_id_parcel_id_fk";
--> statement-breakpoint
ALTER TABLE "item_image" VALIDATE CONSTRAINT "item_image_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "item_change_history" VALIDATE CONSTRAINT "item_change_history_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "item_change_history" VALIDATE CONSTRAINT "item_change_history_actor_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "bin_transfer" VALIDATE CONSTRAINT "bin_transfer_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "bin_transfer" VALIDATE CONSTRAINT "bin_transfer_actor_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "custody_event" VALIDATE CONSTRAINT "custody_event_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "custody_event" VALIDATE CONSTRAINT "custody_event_prev_owner_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "custody_event" VALIDATE CONSTRAINT "custody_event_new_owner_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "custody_event" VALIDATE CONSTRAINT "custody_event_actor_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "storage_cover" VALIDATE CONSTRAINT "storage_cover_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "bin" VALIDATE CONSTRAINT "bin_facility_id_facility_id_fk";
--> statement-breakpoint
ALTER TABLE "facility" VALIDATE CONSTRAINT "facility_forwards_to_facility_id_facility_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel" VALIDATE CONSTRAINT "parcel_owner_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel" VALIDATE CONSTRAINT "parcel_facility_id_facility_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel" VALIDATE CONSTRAINT "parcel_forwarded_from_facility_id_facility_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel" VALIDATE CONSTRAINT "parcel_received_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel" VALIDATE CONSTRAINT "parcel_opened_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel_event" VALIDATE CONSTRAINT "parcel_event_parcel_id_parcel_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel_event" VALIDATE CONSTRAINT "parcel_event_actor_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel_event" VALIDATE CONSTRAINT "parcel_event_facility_id_facility_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel_photo" VALIDATE CONSTRAINT "parcel_photo_parcel_id_parcel_id_fk";
--> statement-breakpoint
ALTER TABLE "parcel_photo" VALIDATE CONSTRAINT "parcel_photo_uploaded_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "arrival_disposal" VALIDATE CONSTRAINT "arrival_disposal_owner_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "arrival_disposal" VALIDATE CONSTRAINT "arrival_disposal_actor_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "listing" VALIDATE CONSTRAINT "listing_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "listing" VALIDATE CONSTRAINT "listing_seller_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" VALIDATE CONSTRAINT "transaction_buyer_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "transaction" VALIDATE CONSTRAINT "transaction_seller_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "offer" VALIDATE CONSTRAINT "offer_listing_id_listing_id_fk";
--> statement-breakpoint
ALTER TABLE "offer" VALIDATE CONSTRAINT "offer_buyer_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "offer" VALIDATE CONSTRAINT "offer_parent_offer_id_offer_id_fk";
--> statement-breakpoint
ALTER TABLE "swap_proposal" VALIDATE CONSTRAINT "swap_proposal_proposer_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "swap_proposal" VALIDATE CONSTRAINT "swap_proposal_responder_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "house_listing" VALIDATE CONSTRAINT "house_listing_created_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "house_order" VALIDATE CONSTRAINT "house_order_buyer_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "house_order" VALIDATE CONSTRAINT "house_order_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "house_order" VALIDATE CONSTRAINT "house_order_transaction_id_transaction_id_fk";
--> statement-breakpoint
ALTER TABLE "house_order" VALIDATE CONSTRAINT "house_order_stowed_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "dispute" VALIDATE CONSTRAINT "dispute_transaction_id_transaction_id_fk";
--> statement-breakpoint
ALTER TABLE "dispute" VALIDATE CONSTRAINT "dispute_opened_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "dispute" VALIDATE CONSTRAINT "dispute_assigned_admin_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "service_request" VALIDATE CONSTRAINT "service_request_requester_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "service_request" VALIDATE CONSTRAINT "service_request_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "service_request" VALIDATE CONSTRAINT "service_request_batch_id_batch_id_fk";
--> statement-breakpoint
ALTER TABLE "service_request" VALIDATE CONSTRAINT "service_request_charge_id_charge_id_fk";
--> statement-breakpoint
ALTER TABLE "service_request" VALIDATE CONSTRAINT "service_request_fulfilled_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "escrow_deal" VALIDATE CONSTRAINT "escrow_deal_funding_attested_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "escrow_deal" VALIDATE CONSTRAINT "escrow_deal_item_id_item_id_fk";
--> statement-breakpoint
ALTER TABLE "escrow_deal" VALIDATE CONSTRAINT "escrow_deal_inspected_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "escrow_deal" VALIDATE CONSTRAINT "escrow_deal_buyer_release_attested_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "escrow_deal" VALIDATE CONSTRAINT "escrow_deal_seller_release_attested_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "escrow_event" VALIDATE CONSTRAINT "escrow_event_actor_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "support_ticket" VALIDATE CONSTRAINT "support_ticket_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "support_ticket" VALIDATE CONSTRAINT "support_ticket_resolved_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "support_message" VALIDATE CONSTRAINT "support_message_ticket_id_support_ticket_id_fk";
--> statement-breakpoint
ALTER TABLE "support_message" VALIDATE CONSTRAINT "support_message_author_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "shipment" VALIDATE CONSTRAINT "shipment_user_id_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "shipment" VALIDATE CONSTRAINT "shipment_quoted_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "shipment" VALIDATE CONSTRAINT "shipment_handed_over_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "shipment" VALIDATE CONSTRAINT "shipment_fulfilled_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "shipment" VALIDATE CONSTRAINT "shipment_pickup_event_id_consignment_event_id_fk";
--> statement-breakpoint
ALTER TABLE "shipment" VALIDATE CONSTRAINT "shipment_merged_into_shipment_id_shipment_id_fk";
--> statement-breakpoint
ALTER TABLE "shipment" VALIDATE CONSTRAINT "shipment_group_id_shipment_group_id_fk";
