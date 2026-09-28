-- Pixels de conversão do checkout de produto (Meta, TikTok, GA4, Google Ads).
-- `expert_profiles.default_tracking_pixels` é o atalho do produtor: copiado
-- para produtos sem pixel daquele provedor e para produtos novos.
-- Shared FE 0131 / BO 0124, same `when` (1801200000000): first apply wins.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "tracking_pixels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "default_tracking_pixels" jsonb DEFAULT '[]'::jsonb NOT NULL;
