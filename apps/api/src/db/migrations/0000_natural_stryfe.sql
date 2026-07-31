CREATE TYPE "public"."account_status" AS ENUM('pending', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'warehouse_operator', 'admin');--> statement-breakpoint
CREATE TYPE "public"."verification_token_type" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."custody_event_type" AS ENUM('intake', 'relocate', 'ownership_transfer', 'state_change', 'hold_placed', 'hold_released', 'batch_split', 'dispatch');--> statement-breakpoint
CREATE TYPE "public"."item_image_type" AS ENUM('intake', 'professional');--> statement-breakpoint
CREATE TYPE "public"."item_lifecycle" AS ENUM('received', 'stored', 'listed', 'on-hold', 'sold', 'shipped', 'donated', 'consigned');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."ledger_type" AS ENUM('purchase', 'sale_credit', 'fee', 'service_charge', 'credit_topup', 'withdrawal', 'interest');--> statement-breakpoint
CREATE TYPE "public"."pricing_model" AS ENUM('fixed', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'sold', 'removed');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'rejected', 'countered');--> statement-breakpoint
CREATE TYPE "public"."swap_status" AS ENUM('pending', 'accepted', 'rejected', 'executed');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('sale', 'swap', 'transfer', 'consignment');--> statement-breakpoint
CREATE TYPE "public"."service_request_status" AS ENUM('requested', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."service_request_type" AS ENUM('batch_split', 'professional_photography', 'third_party_grading', 'donation', 'consignment', 'warehouse_transfer');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('requested', 'rates_selected', 'picking', 'packed', 'labeled', 'shipped', 'in_transit', 'delivered', 'exception');--> statement-breakpoint
CREATE TABLE "login_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" "account_status" DEFAULT 'pending' NOT NULL,
	"intake_id" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" "verification_token_type" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barcode" text NOT NULL,
	"zone" text NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custody_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"event_type" "custody_event_type" NOT NULL,
	"prev_owner_id" text,
	"new_owner_id" text,
	"prev_bin_id" text,
	"new_bin_id" text,
	"prev_state" text,
	"new_state" text,
	"actor_id" text NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"serial_number" text NOT NULL,
	"barcode" text NOT NULL,
	"type_class" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"condition_grade" text,
	"lifecycle_state" "item_lifecycle" DEFAULT 'received' NOT NULL,
	"bin_id" text,
	"source_batch_id" text,
	"hold_flag" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_change_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"type" "item_image_type" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"object_key" text NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_entity" text,
	"target_id" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"action_type" text NOT NULL,
	"pricing_rule_snapshot" jsonb NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"payment_means" text NOT NULL,
	"status" text NOT NULL,
	"reference_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"webhook_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" "ledger_type" NOT NULL,
	"amount" bigint NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"currency" char(3) NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"destination_account" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type" text NOT NULL,
	"item_class" text,
	"parameters" jsonb,
	"model" "pricing_model" NOT NULL,
	"value" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"asking_price" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"parent_offer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposer_id" text NOT NULL,
	"responder_id" text NOT NULL,
	"offered_item_ids" jsonb NOT NULL,
	"requested_item_ids" jsonb NOT NULL,
	"proposer_approved" boolean DEFAULT true NOT NULL,
	"responder_approved" boolean DEFAULT false NOT NULL,
	"status" "swap_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "transaction_type" NOT NULL,
	"item_ids" jsonb NOT NULL,
	"buyer_id" text,
	"seller_id" text,
	"price" bigint,
	"fee" bigint DEFAULT 0 NOT NULL,
	"frozen_pricing" jsonb,
	"currency" char(3) NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "service_request_type" NOT NULL,
	"requester_id" text NOT NULL,
	"item_id" text,
	"batch_id" text,
	"status" "service_request_status" DEFAULT 'requested' NOT NULL,
	"charge_id" text,
	"type_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"item_ids" jsonb NOT NULL,
	"destination_address" text NOT NULL,
	"carrier" text,
	"service_level" text,
	"rush_flag" boolean DEFAULT false NOT NULL,
	"cost" bigint,
	"currency" char(3),
	"status" "shipment_status" DEFAULT 'requested' NOT NULL,
	"tracking_number" text,
	"label_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"user_id" text,
	"endpoint" text NOT NULL,
	"status_code" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmation_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"token_hash" text NOT NULL,
	"payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_email_unique" ON "user_account" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_account_intake_id_unique" ON "user_account" USING btree ("intake_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bin_barcode_unique" ON "bin" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "item_serial_unique" ON "item" USING btree ("serial_number");--> statement-breakpoint
CREATE UNIQUE INDEX "item_barcode_unique" ON "item" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_endpoint_unique" ON "idempotency_key" USING btree ("key","endpoint");