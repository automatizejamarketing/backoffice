-- Pix Automático: additive shared schema; does not modify existing providers.
CREATE TABLE "efi_recurring_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"environment" varchar(16) NOT NULL,
	"plan_type" varchar NOT NULL,
	"amount" integer NOT NULL,
	"contract" varchar(64) NOT NULL,
	"id_rec" varchar(64),
	"location_id" integer,
	"journey" varchar NOT NULL,
	"status" varchar(16) DEFAULT 'creating' NOT NULL,
	"remote_status" varchar(16),
	"creation_phase" varchar(24) DEFAULT 'reserved' NOT NULL,
	"debtor_name" varchar(140) NOT NULL,
	"debtor_document" varchar(14) NOT NULL,
	"debtor_address" jsonb,
	"first_due_date" date NOT NULL,
	"anchor_day" integer NOT NULL,
	"next_cycle" integer NOT NULL,
	"trial" boolean DEFAULT false NOT NULL,
	"trial_granted_at" timestamp,
	"qr_copy_paste" text,
	"expires_at" timestamp NOT NULL,
	"cancel_requested_at" timestamp,
	"canceled_at" timestamp,
	"lease_id" uuid,
	"lease_until" timestamp,
	"last_synced_at" timestamp,
	"next_sync_at" timestamp DEFAULT now() NOT NULL,
	"last_error" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "efi_authorizations_amount_positive" CHECK ("efi_recurring_authorizations"."amount" > 0),
	CONSTRAINT "efi_authorizations_anchor_valid" CHECK ("efi_recurring_authorizations"."anchor_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE "efi_subscription_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authorization_id" uuid NOT NULL,
	"environment" varchar(16) NOT NULL,
	"cycle" integer NOT NULL,
	"purpose" varchar NOT NULL,
	"txid" varchar(35) NOT NULL,
	"amount" integer NOT NULL,
	"due_date" date NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" varchar(16) DEFAULT 'reserved' NOT NULL,
	"end_to_end_id" varchar(32),
	"payment_id" uuid,
	"retry_date" date,
	"retry_uncertain" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "efi_charges_amount_positive" CHECK ("efi_subscription_charges"."amount" > 0),
	CONSTRAINT "efi_charges_period_valid" CHECK ("efi_subscription_charges"."period_end" > "efi_subscription_charges"."period_start")
);
--> statement-breakpoint
CREATE TABLE "efi_webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" varchar(16) NOT NULL,
	"kind" varchar NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"event_hash" varchar(64) NOT NULL,
	"fee_amount" integer,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp,
	"processed_at" timestamp,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"last_error" varchar(64)
);
--> statement-breakpoint
ALTER TABLE "efi_recurring_authorizations" ADD CONSTRAINT "efi_recurring_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "efi_recurring_authorizations" ADD CONSTRAINT "efi_recurring_authorizations_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "efi_subscription_charges" ADD CONSTRAINT "efi_subscription_charges_authorization_id_efi_recurring_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."efi_recurring_authorizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "efi_subscription_charges" ADD CONSTRAINT "efi_subscription_charges_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "efi_authorizations_contract_unique" ON "efi_recurring_authorizations" USING btree ("environment","contract");
--> statement-breakpoint
CREATE UNIQUE INDEX "efi_authorizations_rec_unique" ON "efi_recurring_authorizations" USING btree ("environment","id_rec");
--> statement-breakpoint
CREATE UNIQUE INDEX "efi_authorizations_live_user_unique" ON "efi_recurring_authorizations" USING btree ("user_id") WHERE "efi_recurring_authorizations"."status" IN ('creating', 'pending', 'approved', 'review');
--> statement-breakpoint
CREATE INDEX "efi_authorizations_sync_idx" ON "efi_recurring_authorizations" USING btree ("environment","next_sync_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "efi_charges_cycle_unique" ON "efi_subscription_charges" USING btree ("authorization_id","cycle");
--> statement-breakpoint
CREATE UNIQUE INDEX "efi_charges_txid_unique" ON "efi_subscription_charges" USING btree ("environment","txid");
--> statement-breakpoint
CREATE UNIQUE INDEX "efi_charges_e2e_unique" ON "efi_subscription_charges" USING btree ("environment","end_to_end_id");
--> statement-breakpoint
CREATE INDEX "efi_charges_pending_idx" ON "efi_subscription_charges" USING btree ("authorization_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "efi_inbox_event_unique" ON "efi_webhook_inbox" USING btree ("environment","event_hash");
--> statement-breakpoint
CREATE INDEX "efi_inbox_work_idx" ON "efi_webhook_inbox" USING btree ("environment","status","available_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_efi_external_id_unique" ON "payments" USING btree ("external_id") WHERE "payments"."provider" = 'efi';
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_efi_external_id_required" CHECK ("provider" <> 'efi' OR "external_id" IS NOT NULL);
