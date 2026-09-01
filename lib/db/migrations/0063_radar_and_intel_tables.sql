-- Radar / "Conteúdos em Alta" + referências de anúncios (intel).
--
-- Estas 7 tabelas eram declaradas em `lib/db/schema.ts` nos DOIS projetos e
-- consultadas por `lib/db/radar-queries.ts`, mas NUNCA existiram em produção:
-- a DDL do Radar só vivia em `scripts/migrate-radar.ts` (um script avulso, que
-- apontava para o banco de staging) e a de intel numa migration órfã
-- (`0048_intel_ad_references.sql`, que não está em journal nenhum e por isso
-- nunca roda). Abrir a página quebrava com "relation does not exist".
--
-- Aqui a DDL vira migration de verdade. O conteúdo foi extraído das duas
-- fontes sem reescrita, e a lista de colunas de cada tabela foi conferida
-- contra `schema.ts` — as 7 batem coluna a coluna.
--
-- Estritamente aditiva: só `CREATE TABLE/INDEX IF NOT EXISTS`. `when` acima da
-- marca de produção (1794770000000) e da de staging (1794800000000), então os
-- dois ambientes aplicam; em staging as tabelas já existem e o IF NOT EXISTS
-- torna a aplicação um no-op que apenas registra a migration.

CREATE TABLE IF NOT EXISTS radar_search_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  niche TEXT,
  sub_niche TEXT,
  keywords JSONB,
  hashtags JSONB,
  profiles JSONB,
  platforms JSONB,
  formats JSONB,
  country TEXT,
  state TEXT,
  city TEXT,
  frequency TEXT,
  max_results INTEGER,
  min_score INTEGER,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS radar_collection_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id UUID REFERENCES radar_search_configurations(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  items_found INTEGER NOT NULL DEFAULT 0,
  items_new INTEGER NOT NULL DEFAULT 0,
  items_updated INTEGER NOT NULL DEFAULT 0,
  items_duplicated INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  credits_consumed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  executed_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS radar_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  format TEXT,
  profile_handle TEXT,
  caption TEXT,
  thumbnail_url TEXT,
  preview_url TEXT,
  original_url TEXT,
  current_metrics JSONB,
  trend_score NUMERIC,
  classification TEXT,
  trend_status TEXT,
  niche TEXT,
  sub_niche TEXT,
  location TEXT,
  published_at TIMESTAMP,
  first_detected_at TIMESTAMP NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMP NOT NULL DEFAULT now(),
  publication_status TEXT NOT NULL DEFAULT 'pending',
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  admin_notes TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS radar_content_platform_external_id_idx ON radar_contents (platform, external_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS radar_content_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES radar_contents(id) ON DELETE CASCADE,
  collected_at TIMESTAMP NOT NULL DEFAULT now(),
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  saves INTEGER,
  profile_followers INTEGER
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "advertisers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_advertiser_id" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "instagram_handle" varchar(255),
  "facebook_page_id" varchar(255),
  "investment_intensity_score" integer DEFAULT 0,
  "state" varchar(50),
  "city" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "advertisers_external_advertiser_id_unique" UNIQUE("external_advertiser_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "advertisers_instagram_handle_idx" ON "advertisers" ("instagram_handle");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "advertisers_investment_intensity_score_idx" ON "advertisers" ("investment_intensity_score");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_creatives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "advertiser_id" uuid NOT NULL REFERENCES "advertisers" ("id"),
  "external_ad_id" varchar(255) NOT NULL,
  "body" text,
  "headline" text,
  "description" text,
  "call_to_action" varchar(100),
  "video_url" text,
  "thumbnail_url" text,
  "category" varchar(100) NOT NULL,
  "subcategory" varchar(100) NOT NULL,
  "category_confidence" numeric(3,2),
  "product_relevance_score" integer,
  "creative_strength_score" integer,
  "advertiser_continuity_score" integer,
  "creative_type" varchar(50),
  "is_active" boolean DEFAULT true NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "platforms" jsonb,
  "start_date" timestamp,
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ad_creatives_external_ad_id_unique" UNIQUE("external_ad_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_creatives_advertiser_id_idx" ON "ad_creatives" ("advertiser_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_creatives_category_idx" ON "ad_creatives" ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_creatives_subcategory_idx" ON "ad_creatives" ("subcategory");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_creatives_is_active_idx" ON "ad_creatives" ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_creatives_is_published_idx" ON "ad_creatives" ("is_published");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ad_creative_id" uuid NOT NULL REFERENCES "ad_creatives" ("id"),
  "is_active" boolean NOT NULL,
  "checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_snapshots_ad_creative_id_idx" ON "ad_snapshots" ("ad_creative_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_snapshots_checked_at_idx" ON "ad_snapshots" ("checked_at");
