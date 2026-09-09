ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_expert_participation_range";--> statement-breakpoint

ALTER TABLE "products"
  ADD CONSTRAINT "products_expert_participation_range"
  CHECK (
    "expert_participation_bps" IS NULL
    OR (
      "expert_participation_bps" >= 0
      AND "expert_participation_bps" <= 9999
    )
  ) NOT VALID;
