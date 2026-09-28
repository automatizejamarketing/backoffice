-- Pixels de conversão do checkout de produto (Meta, TikTok, GA4, Google Ads)
-- e tokens da API de Conversões da Meta (`product_pixel_credentials`, só servidor).
-- `expert_profiles.default_tracking_pixels` é o atalho do produtor: copiado
-- para produtos sem pixel daquele provedor e para produtos novos.
-- Shared FE 0131 / BO 0124, same `when` (1801200000000): first apply wins.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "tracking_pixels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "default_tracking_pixels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "product_pixel_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expert_id" uuid REFERENCES "expert_profiles"("id") ON DELETE CASCADE,
  "provider" varchar(30) NOT NULL,
  "pixel_id" varchar(40) NOT NULL,
  "access_token" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_pixel_credentials_owner_pixel_unique"
    UNIQUE NULLS NOT DISTINCT ("expert_id", "provider", "pixel_id")
);
