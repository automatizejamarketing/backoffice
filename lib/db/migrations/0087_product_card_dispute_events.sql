ALTER TABLE "product_card_disputes"
  ADD COLUMN IF NOT EXISTS "responsible" varchar DEFAULT 'automatize' NOT NULL;
ALTER TABLE "product_card_disputes"
  ADD COLUMN IF NOT EXISTS "response_due_at" timestamp;

CREATE TABLE IF NOT EXISTS "product_card_dispute_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" uuid NOT NULL REFERENCES "product_card_disputes"("id"),
  "provider" varchar(30) NOT NULL,
  "provider_event_id" varchar(255) NOT NULL,
  "event_type" varchar(120) NOT NULL,
  "raw_payload" jsonb NOT NULL,
  "occurred_at" timestamp NOT NULL,
  "observed_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_card_dispute_events_provider_event_unique"
    UNIQUE("provider", "provider_event_id")
);
CREATE INDEX IF NOT EXISTS "product_card_dispute_events_dispute_id_idx"
  ON "product_card_dispute_events" ("dispute_id");
