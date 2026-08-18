-- Official WhatsApp channel for each food-service location.
-- Provider credentials stay outside this schema; only an opaque reference is stored.

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id") ON DELETE CASCADE,
  "phone_number_id" varchar(64) NOT NULL,
  "waba_id" varchar(64) NOT NULL,
  "display_phone_e164" varchar(24) NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "credential_reference" text,
  "connected_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_whatsapp_connections_status_check" CHECK ("status" IN ('pending', 'connected', 'disconnected'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_connections_phone_number_unique" ON "food_service_whatsapp_connections"("phone_number_id");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_connections_location_unique" ON "food_service_whatsapp_connections"("location_id");
CREATE INDEX IF NOT EXISTS "food_service_whatsapp_connections_company_idx" ON "food_service_whatsapp_connections"("company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_operators" (
  "connection_id" uuid NOT NULL REFERENCES "food_service_whatsapp_connections"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "phone_e164" varchar(24) NOT NULL,
  "role" varchar NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("connection_id", "user_id"),
  CONSTRAINT "food_service_whatsapp_operators_role_check" CHECK ("role" IN ('owner', 'admin', 'member'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_operators_contact_unique" ON "food_service_whatsapp_operators"("connection_id", "phone_e164");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_consumer_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "connection_id" uuid NOT NULL REFERENCES "food_service_whatsapp_connections"("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL REFERENCES "company_locations"("id") ON DELETE CASCADE,
  "customer_phone_e164" varchar(24) NOT NULL,
  "active_cart_id" uuid REFERENCES "food_service_carts"("id"),
  "last_order_id" uuid REFERENCES "food_service_orders"("id"),
  "last_inbound_message_id" varchar(255),
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_consumer_sessions_contact_unique" ON "food_service_whatsapp_consumer_sessions"("connection_id", "customer_phone_e164");
CREATE INDEX IF NOT EXISTS "food_service_whatsapp_consumer_sessions_expiry_idx" ON "food_service_whatsapp_consumer_sessions"("expires_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "connection_id" uuid NOT NULL REFERENCES "food_service_whatsapp_connections"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "food_service_orders"("id"),
  "recipient_phone_e164" varchar(24) NOT NULL,
  "purpose" varchar NOT NULL,
  "body" text NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "provider_message_id" varchar(255),
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "sent_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_whatsapp_outbox_purpose_check" CHECK ("purpose" IN ('consumer_reply', 'order_received', 'order_accepted', 'order_status')),
  CONSTRAINT "food_service_whatsapp_outbox_status_check" CHECK ("status" IN ('pending', 'sending', 'sent', 'failed')),
  CONSTRAINT "food_service_whatsapp_outbox_attempt_count_check" CHECK ("attempt_count" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_whatsapp_outbox_idempotency_unique" ON "food_service_whatsapp_outbox"("connection_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "food_service_whatsapp_outbox_pending_idx" ON "food_service_whatsapp_outbox"("status", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_whatsapp_inbox" (
  "message_id" varchar(255) PRIMARY KEY,
  "connection_id" uuid NOT NULL REFERENCES "food_service_whatsapp_connections"("id") ON DELETE CASCADE,
  "consumer_session_id" uuid REFERENCES "food_service_whatsapp_consumer_sessions"("id"),
  "operator_user_id" uuid REFERENCES "users"("id"),
  "sender_phone_e164" varchar(24) NOT NULL,
  "role" varchar NOT NULL,
  "text" text NOT NULL,
  "status" varchar NOT NULL DEFAULT 'pending',
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_whatsapp_inbox_role_check" CHECK ("role" IN ('operator', 'consumer')),
  CONSTRAINT "food_service_whatsapp_inbox_status_check" CHECK ("status" IN ('pending', 'processing', 'processed', 'failed')),
  CONSTRAINT "food_service_whatsapp_inbox_identity_check" CHECK (
    ("role" = 'operator' AND "operator_user_id" IS NOT NULL AND "consumer_session_id" IS NULL)
    OR
    ("role" = 'consumer' AND "consumer_session_id" IS NOT NULL AND "operator_user_id" IS NULL)
  )
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_whatsapp_inbox_pending_idx" ON "food_service_whatsapp_inbox"("status", "created_at");
