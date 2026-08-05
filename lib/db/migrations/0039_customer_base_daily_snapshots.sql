CREATE TABLE IF NOT EXISTS "customer_base_daily_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_date" date NOT NULL,
  "active_paying" integer NOT NULL,
  "trial" integer NOT NULL,
  "churn_total" integer NOT NULL,
  "churn_card" integer NOT NULL,
  "churn_pix" integer NOT NULL,
  "scheduled_cancel" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_base_daily_snapshots_snapshot_date_unique"
  ON "customer_base_daily_snapshots" ("snapshot_date");

CREATE INDEX IF NOT EXISTS "customer_base_daily_snapshots_snapshot_date_idx"
  ON "customer_base_daily_snapshots" ("snapshot_date");
