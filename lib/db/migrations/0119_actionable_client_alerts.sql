-- Alertas acionáveis do cliente: ciclo de vida, run unificado e ações idempotentes.
-- Shared FE 0126 / BO 0119, same `when` (1800900000000): first apply wins.

ALTER TABLE "proactive_signals"
  ADD COLUMN IF NOT EXISTS "seen_at" timestamp,
  ADD COLUMN IF NOT EXISTS "resolution_source" varchar(32),
  ADD COLUMN IF NOT EXISTS "analysis_run_id" uuid;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proactive_signals_unseen_open_idx"
  ON "proactive_signals" ("status", "seen_at", "first_detected_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "proactive_signal_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "signal_id" uuid NOT NULL REFERENCES "proactive_signals"("id"),
  "action_key" varchar(64) NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "request" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "correlation_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  CONSTRAINT "proactive_signal_actions_idempotency_unique" UNIQUE ("idempotency_key")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proactive_signal_actions_signal_idx"
  ON "proactive_signal_actions" ("signal_id", "created_at");--> statement-breakpoint

ALTER TABLE "proactive_signal_evaluations"
  ADD COLUMN IF NOT EXISTS "last_unified_at" timestamp;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proactive_signal_evaluations_last_unified_at_idx"
  ON "proactive_signal_evaluations" ("last_unified_at");
