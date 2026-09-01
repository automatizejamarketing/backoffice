import postgres from "postgres";

const sql = postgres("postgres://postgres.wsbsnzgzqiehqnklzchm:JSQA7IYULkElUbXW@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require", {
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    await sql.begin(async (sql) => {
      await sql`
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
      `;

      await sql`
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
      `;

      await sql`
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
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS radar_content_platform_external_id_idx ON radar_contents (platform, external_id);
      `;

      await sql`
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
      `;
    });
    console.log("Migration applied successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await sql.end();
  }
}

main();
