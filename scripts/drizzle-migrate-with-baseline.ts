/**
 * Runs `drizzle-kit migrate`. If the DB was created with `db:push` (or otherwise)
 * without recording migration 0000 in `drizzle.__drizzle_migrations`, the first
 * migration fails with "already exists". We baseline the first journal entry
 * when `public.users` exists but that migration hash is missing, then re-run migrate.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backofficeRoot = join(scriptDir, "..");

if (existsSync(join(backofficeRoot, ".env"))) {
  config({ path: join(backofficeRoot, ".env") });
}
if (existsSync(join(backofficeRoot, ".env.local"))) {
  config({ path: join(backofficeRoot, ".env.local"), override: true });
}

const migrationsFolder = join(backofficeRoot, "lib/db/migrations");
const journalPath = join(migrationsFolder, "meta/_journal.json");

async function baselineFirstMigrationIfNeeded(sql: postgres.Sql) {
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const first = journal.entries[0];
  if (!first) return;

  const migrationSql = readFileSync(
    join(migrationsFolder, `${first.tag}.sql`),
    "utf8",
  );
  const hash = createHash("sha256").update(migrationSql).digest("hex");

  const existing = await sql`
    SELECT 1 AS ok
    FROM drizzle.__drizzle_migrations
    WHERE hash = ${hash}
    LIMIT 1
  `;
  if (Array.isArray(existing) && existing.length > 0) {
    return;
  }

  const usersCheck = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists
  `;
  const usersExists =
    Array.isArray(usersCheck) &&
    usersCheck[0] &&
    (usersCheck[0] as { exists: boolean }).exists === true;
  if (!usersExists) {
    return;
  }

  await sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${first.when})
  `;
  console.log(
    `[drizzle-migrate] Baseline recorded for ${first.tag} (existing DB without migration history).`,
  );
}

function runDrizzleMigrate(): number {
  const drizzleKit = join(
    backofficeRoot,
    "node_modules",
    "drizzle-kit",
    "bin.cjs",
  );
  const r = spawnSync(process.execPath, [drizzleKit, "migrate"], {
    cwd: backofficeRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (r.error) {
    throw r.error;
  }
  return r.status ?? 1;
}

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error("POSTGRES_URL is not set. Add it to .env or .env.local.");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await sql`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;
    await baselineFirstMigrationIfNeeded(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }

  const code = runDrizzleMigrate();
  process.exit(code);
}

void main();
