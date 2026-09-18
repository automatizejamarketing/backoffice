CREATE TABLE IF NOT EXISTS "whatsapp_support_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operator_email" varchar(100) NOT NULL,
  "target_user_id" uuid NOT NULL,
  "phone_e164" varchar(20) NOT NULL,
  "environment" varchar(16) NOT NULL,
  "reason" text NOT NULL,
  "duration_minutes" integer NOT NULL,
  "activation_code_hash" varchar(64) NOT NULL,
  "activation_code_expires_at" timestamp NOT NULL,
  "activation_attempts" integer DEFAULT 0 NOT NULL,
  "activated_at" timestamp,
  "expires_at" timestamp,
  "ended_at" timestamp,
  "ended_by_email" varchar(100),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_support_sessions_target_user_id_users_id_fk"
    FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id")
    ON DELETE no action ON UPDATE no action,
  CONSTRAINT "whatsapp_support_sessions_environment_check"
    CHECK ("environment" IN ('staging', 'prod')),
  CONSTRAINT "whatsapp_support_sessions_duration_check"
    CHECK ("duration_minutes" IN (15, 30, 60)),
  CONSTRAINT "whatsapp_support_sessions_activation_attempts_check"
    CHECK ("activation_attempts" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_support_sessions_phone_environment_idx"
  ON "whatsapp_support_sessions" ("phone_e164", "environment", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_support_sessions_target_user_idx"
  ON "whatsapp_support_sessions" ("target_user_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_support_session_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "event_type" varchar(48) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_support_session_events_session_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."whatsapp_support_sessions"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_support_session_events_session_created_idx"
  ON "whatsapp_support_session_events" ("session_id", "created_at");
--> statement-breakpoint
ALTER TABLE "whatsapp_support_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "whatsapp_support_session_events" ENABLE ROW LEVEL SECURITY;
