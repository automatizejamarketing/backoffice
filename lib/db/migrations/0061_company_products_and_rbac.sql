-- Company-scoped product entitlements are the access authority.
-- Stripe subscriptions remain billing records and never grant access by query alone.

ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_id_company_unique" UNIQUE ("id", "company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_product_entitlements" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "product_code" varchar NOT NULL,
  "status" varchar NOT NULL,
  "source" varchar NOT NULL,
  "valid_from" timestamp NOT NULL DEFAULT now(),
  "valid_until" timestamp,
  "source_reference" varchar(255),
  "granted_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("company_id", "product_code"),
  CONSTRAINT "company_product_entitlements_product_code_check" CHECK ("product_code" IN ('traffic', 'menu_orders', 'inventory_cmv')),
  CONSTRAINT "company_product_entitlements_status_check" CHECK ("status" IN ('active', 'expired', 'revoked')),
  CONSTRAINT "company_product_entitlements_source_check" CHECK ("source" IN ('legacy_subscription', 'stripe', 'manual')),
  CONSTRAINT "company_product_entitlements_valid_until_check" CHECK ("source" = 'manual' OR "valid_until" IS NOT NULL),
  CONSTRAINT "company_product_entitlements_valid_period_check" CHECK (("status" = 'active' AND ("valid_until" IS NULL OR "valid_until" > "valid_from")) OR ("status" IN ('expired', 'revoked') AND "valid_until" IS NOT NULL AND "valid_until" >= "valid_from")),
  CONSTRAINT "company_product_entitlements_lifecycle_check" CHECK ("status" = 'active' OR "valid_until" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_product_entitlements_company_status_idx" ON "company_product_entitlements"("company_id", "status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_product_entitlement_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "product_code" varchar NOT NULL,
  "event_type" varchar NOT NULL,
  "status" varchar NOT NULL,
  "source" varchar NOT NULL,
  "valid_from" timestamp NOT NULL,
  "valid_until" timestamp,
  "idempotency_key" varchar(255) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "metadata" jsonb,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_product_entitlement_events_entitlement_fk" FOREIGN KEY ("company_id", "product_code") REFERENCES "company_product_entitlements"("company_id", "product_code"),
  CONSTRAINT "company_product_entitlement_events_product_code_check" CHECK ("product_code" IN ('traffic', 'menu_orders', 'inventory_cmv')),
  CONSTRAINT "company_product_entitlement_events_event_type_check" CHECK ("event_type" IN ('activated', 'renewed', 'expired', 'revoked', 'corrected')),
  CONSTRAINT "company_product_entitlement_events_status_check" CHECK ("status" IN ('active', 'expired', 'revoked')),
  CONSTRAINT "company_product_entitlement_events_source_check" CHECK ("source" IN ('legacy_subscription', 'stripe', 'manual')),
  CONSTRAINT "company_product_entitlement_events_valid_until_check" CHECK ("source" = 'manual' OR "valid_until" IS NOT NULL),
  CONSTRAINT "company_product_entitlement_events_valid_period_check" CHECK (("status" = 'active' AND ("valid_until" IS NULL OR "valid_until" > "valid_from")) OR ("status" IN ('expired', 'revoked') AND "valid_until" IS NOT NULL AND "valid_until" >= "valid_from")),
  CONSTRAINT "company_product_entitlement_events_lifecycle_check" CHECK ("status" = 'active' OR "valid_until" IS NOT NULL)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_product_entitlement_events_idempotency_unique" ON "company_product_entitlement_events"("idempotency_key");
CREATE INDEX IF NOT EXISTS "company_product_entitlement_events_entitlement_occurred_idx" ON "company_product_entitlement_events"("company_id", "product_code", "occurred_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_company_product_entitlement_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'company_product_entitlement_events is append-only';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "company_product_entitlement_events_append_only" ON "company_product_entitlement_events";
CREATE TRIGGER "company_product_entitlement_events_append_only" BEFORE UPDATE OR DELETE ON "company_product_entitlement_events" FOR EACH ROW EXECUTE FUNCTION prevent_company_product_entitlement_event_mutation();--> statement-breakpoint
DROP TRIGGER IF EXISTS "company_product_entitlement_events_no_truncate" ON "company_product_entitlement_events";
CREATE TRIGGER "company_product_entitlement_events_no_truncate" BEFORE TRUNCATE ON "company_product_entitlement_events" FOR EACH STATEMENT EXECUTE FUNCTION prevent_company_product_entitlement_event_mutation();--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_module_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "billing_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "offer_code" varchar NOT NULL,
  "status" varchar NOT NULL,
  "stripe_customer_id" varchar(255) NOT NULL,
  "stripe_subscription_id" varchar(255),
  "stripe_price_id" varchar(255) NOT NULL,
  "current_period_start" timestamp,
  "current_period_end" timestamp,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "canceled_at" timestamp,
  "last_provider_event_at" timestamp,
  "last_provider_event_id" varchar(255),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_module_subscriptions_offer_code_check" CHECK ("offer_code" IN ('menu_orders', 'inventory_cmv', 'operation_complete')),
  CONSTRAINT "company_module_subscriptions_status_check" CHECK ("status" IN ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_module_subscriptions_stripe_subscription_unique" ON "company_module_subscriptions"("stripe_subscription_id") WHERE "stripe_subscription_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "company_module_subscriptions_company_idx" ON "company_module_subscriptions"("company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_member_access_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "capability" varchar NOT NULL,
  "location_id" uuid,
  "granted_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_member_access_grants_membership_fk" FOREIGN KEY ("user_id", "company_id") REFERENCES "user_companies"("user_id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "company_member_access_grants_location_company_fk" FOREIGN KEY ("location_id", "company_id") REFERENCES "company_locations"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "company_member_access_grants_capability_check" CHECK ("capability" IN ('company:manage', 'billing:manage', 'members:manage', 'menu:view', 'menu:manage_base', 'menu:manage_unit', 'orders:view', 'orders:operate', 'whatsapp:manage', 'inventory:view', 'inventory:operate', 'inventory:manage', 'purchasing:view', 'purchasing:operate', 'cmv:view'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_member_access_grants_scope_unique" ON "company_member_access_grants"("company_id", "user_id", "capability", COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS "company_member_access_grants_member_idx" ON "company_member_access_grants"("company_id", "user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "email" varchar(320) NOT NULL,
  "company_role" varchar NOT NULL DEFAULT 'member',
  "token_hash" text NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "invited_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "accepted_by_user_id" uuid REFERENCES "users"("id"),
  "expires_at" timestamp NOT NULL,
  "accepted_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_invitations_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "company_invitations_id_company_unique" UNIQUE ("id", "company_id"),
  CONSTRAINT "company_invitations_company_role_check" CHECK ("company_role" IN ('admin', 'member')),
  CONSTRAINT "company_invitations_status_check" CHECK ("status" IN ('pending', 'accepted', 'revoked', 'expired')),
  CONSTRAINT "company_invitations_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "company_invitations_lifecycle_check" CHECK (("status" = 'pending' AND "accepted_by_user_id" IS NULL AND "accepted_at" IS NULL AND "revoked_at" IS NULL) OR ("status" = 'accepted' AND "accepted_by_user_id" IS NOT NULL AND "accepted_at" IS NOT NULL AND "accepted_at" >= "created_at" AND "accepted_at" <= "expires_at" AND "revoked_at" IS NULL) OR ("status" = 'revoked' AND "accepted_by_user_id" IS NULL AND "accepted_at" IS NULL AND "revoked_at" IS NOT NULL AND "revoked_at" >= "created_at") OR ("status" = 'expired' AND "accepted_by_user_id" IS NULL AND "accepted_at" IS NULL AND "revoked_at" IS NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_invitations_company_status_idx" ON "company_invitations"("company_id", "status");
CREATE INDEX IF NOT EXISTS "company_invitations_expires_at_idx" ON "company_invitations"("expires_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_invitation_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invitation_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "capability" varchar NOT NULL,
  "location_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "company_invitation_grants_invitation_company_fk" FOREIGN KEY ("invitation_id", "company_id") REFERENCES "company_invitations"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "company_invitation_grants_location_company_fk" FOREIGN KEY ("location_id", "company_id") REFERENCES "company_locations"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "company_invitation_grants_capability_check" CHECK ("capability" IN ('company:manage', 'billing:manage', 'members:manage', 'menu:view', 'menu:manage_base', 'menu:manage_unit', 'orders:view', 'orders:operate', 'whatsapp:manage', 'inventory:view', 'inventory:operate', 'inventory:manage', 'purchasing:view', 'purchasing:operate', 'cmv:view'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_invitation_grants_scope_unique" ON "company_invitation_grants"("invitation_id", "capability", COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid));
