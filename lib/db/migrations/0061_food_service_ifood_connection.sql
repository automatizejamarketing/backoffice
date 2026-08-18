-- Company-scoped iFood merchant grant. App credentials and access tokens
-- stay outside this schema; only the authorized merchant id is stored.

CREATE TABLE IF NOT EXISTS "food_service_ifood_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "merchant_id" varchar(200) NOT NULL,
  "merchant_name" varchar(160),
  "catalog_id" varchar(200),
  "status" varchar NOT NULL DEFAULT 'connected',
  "connected_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_ifood_connections_status_check" CHECK ("status" IN ('connected', 'revoked'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_ifood_connections_company_unique" ON "food_service_ifood_connections"("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_ifood_connections_merchant_unique" ON "food_service_ifood_connections"("merchant_id") WHERE "status" = 'connected';
