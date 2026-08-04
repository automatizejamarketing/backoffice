import postgres from "postgres"
import { config } from "dotenv"
import { existsSync } from "node:fs"

if (existsSync(".env")) {
  config({ path: ".env" })
}
if (existsSync(".env.local")) {
  config({ path: ".env.local", override: true })
}

const POSTGRES_URL = process.env.POSTGRES_URL

if (!POSTGRES_URL) {
  console.error("❌ POSTGRES_URL environment variable is not set")
  process.exit(1)
}

const sql = postgres(POSTGRES_URL, { max: 1, prepare: false })

async function main() {
  await sql.unsafe(`
    create table if not exists video_templates (
      id uuid primary key default gen_random_uuid() not null,
      name varchar(255) not null,
      description text,
      thumbnail_url text,
      video_preview_url text,
      category varchar(128),
      max_duration integer,
      position integer default 0 not null,
      status varchar default 'inactive' not null,
      creatomate_template_id varchar(255) not null,
      video_source_key varchar(128) default 'Video-1' not null,
      created_at timestamp default now() not null,
      updated_at timestamp default now() not null
    )
  `)

  await sql.unsafe(
    `alter table video_templates add column if not exists max_duration integer`,
  )

  await sql.unsafe(
    `create index if not exists video_templates_status_position_idx on video_templates (status, position)`
  )

  console.log("✅ video_templates ensured")
}

main()
  .catch((error) => {
    console.error("❌ ensure-video-templates-table failed:", error)
    process.exit(1)
  })
  .finally(async () => {
    await sql.end({ timeout: 5 })
  })

