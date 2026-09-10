-- Preserve the legacy nullable field still declared by both applications.
-- The post-sale removal migration drops it, while a fresh entitlement query
-- can still select it through the shared Drizzle schema.
ALTER TABLE "product_entitlements"
  ADD COLUMN IF NOT EXISTS "suspended_by_pix_fraud_case_id" uuid;
