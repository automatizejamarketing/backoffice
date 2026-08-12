/**
 * Confere o journal de migrations contra o banco e, com `--repair`, aplica o
 * que o `drizzle-kit migrate` pulou em silêncio.
 *
 * O "pulou em silêncio" tem causa conhecida e está explicada em
 * `lib/db/migration-audit.ts`: o drizzle compara `when` com uma marca d'água
 * única, os dois repositórios dividem a mesma tabela de controle, e quem chegar
 * com `when` abaixo da marca fica de fora para sempre — sem erro, sem aviso.
 *
 *   bun run db:migrate:status                 # audita o banco do APP_ENV atual
 *   bun run db:migrate:repair                 # mostra o plano de reparo
 *   bun run db:migrate:repair --yes           # executa o reparo
 *
 * `APP_ENV` escolhe o arquivo de env, e é por isso que o script imprime o
 * projeto Supabase alvo antes de qualquer coisa. Produção é
 * `hosjqwtfjjtmphchsuqf` e staging é `wsbsnzgzqiehqnklzchm`; note que
 * `APP_ENV=local` também cai em produção, porque o `.env.local` vem do ambiente
 * *development* da Vercel e é lá que mora a `POSTGRES_URL` de produção. Ler o
 * cabeçalho antes de responder `--yes` é o que separa reparar o banco certo de
 * reparar o errado achando que é o certo.
 */
import postgres from "postgres";

import { loadAppEnv } from "../lib/env/load-env";
import {
  auditMigrations,
  isBroken,
  readMigrationJournal,
  type AuditRow,
  type MigrationFile,
} from "../lib/db/migration-audit";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backofficeRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appEnv = loadAppEnv(backofficeRoot);

const migrationsFolder = join(backofficeRoot, "lib/db/migrations");

const repair = process.argv.includes("--repair");
const confirmed = process.argv.includes("--yes");

function describeTarget(url: string): string {
  const parsed = new URL(url);
  // No pooler do Supabase o usuário é `postgres.<project-ref>`.
  const projectRef = parsed.username.split(".")[1] ?? "(desconhecido)";
  return `APP_ENV=${appEnv} → projeto ${projectRef} @ ${parsed.hostname}`;
}

function describeRow(row: AuditRow): string {
  const parts: string[] = [];
  if (row.missingTables.length > 0) {
    parts.push(`tabelas ausentes: ${row.missingTables.join(", ")}`);
  }
  if (row.missingColumns.length > 0) {
    parts.push(
      `colunas ausentes: ${row.missingColumns
        .map(({ table, column }) => `${table}.${column}`)
        .join(", ")}`,
    );
  }
  return parts.join(" | ");
}

/**
 * Mesma divisão que o drizzle usa. Pedaços só com comentário viram string
 * vazia depois do `trim` e são descartados — mandar isso para o Postgres pelo
 * protocolo estendido é erro de sintaxe.
 */
function statementsOf(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !/^(--[^\n]*\n?)*$/.test(chunk));
}

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error("POSTGRES_URL não definido. Confira o arquivo de env do APP_ENV.");
    process.exit(1);
  }

  console.log(`[migration-audit] ${describeTarget(url)}\n`);

  const files = readMigrationJournal(migrationsFolder);
  // `CREATE … IF NOT EXISTS` emite NOTICE a cada execução; abafa para o
  // relatório não afogar o que importa.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  let rows: AuditRow[];
  try {
    await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await sql`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;

    const applied = (await sql`
      SELECT hash, created_at FROM drizzle.__drizzle_migrations
    `) as Array<{ hash: string; created_at: string | null }>;

    const tables = (await sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `) as Array<{ table_name: string }>;

    const columns = (await sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
    `) as Array<{ table_name: string; column_name: string }>;

    rows = auditMigrations({
      files,
      appliedHashes: new Set(applied.map((row) => row.hash)),
      watermark: applied.reduce(
        (max, row) => Math.max(max, Number(row.created_at ?? 0)),
        0,
      ),
      existingTables: new Set(tables.map((row) => row.table_name)),
      existingColumns: new Set(
        columns.map((row) => `${row.table_name}.${row.column_name}`),
      ),
    });

    const broken = rows.filter(isBroken);
    const skipped = rows.filter((row) => row.state === "skipped");
    const pending = rows.filter((row) => row.state === "pending");

    console.log(
      `${rows.length} entradas no journal — ${rows.filter((r) => r.state === "applied").length} registradas, ` +
        `${pending.length} pendentes, ${skipped.length} fora do alcance da marca d'água.`,
    );

    if (pending.length > 0) {
      console.log(`\nPendentes (o próximo db:migrate aplica):`);
      for (const row of pending) console.log(`  ${row.tag} (when=${row.when})`);
    }

    if (broken.length === 0) {
      console.log("\nNenhuma migration pulada deixou objeto faltando. Banco íntegro.");
      return;
    }

    console.log(`\n${broken.length} migration(s) pulada(s) com objeto faltando no banco:`);
    for (const row of broken) {
      console.log(`  !! ${row.tag} (when=${row.when}, estado=${row.state})`);
      console.log(`     ${describeRow(row)}`);
    }

    if (!repair) {
      console.log(
        `\nPara aplicar: APP_ENV=${appEnv} bun run db:migrate:repair --yes`,
      );
      process.exitCode = 1;
      return;
    }

    if (!confirmed) {
      console.log(
        `\nPlano de reparo (nada foi executado). Confirme com --yes para aplicar ` +
          `em ${describeTarget(url)}.`,
      );
      process.exitCode = 1;
      return;
    }

    const byTag = new Map<string, MigrationFile>(
      files.map((file) => [file.tag, file]),
    );

    for (const row of broken) {
      const file = byTag.get(row.tag);
      if (!file) continue;

      const statements = statementsOf(file.sql);
      console.log(`\n[repair] ${row.tag} — ${statements.length} statements`);

      await sql.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        // Grava com o `when` do próprio journal, e não com um valor acima da
        // marca d'água. Levantar a marca aqui empurraria para o limbo qualquer
        // migration ainda pendente do repositório irmão — seria trocar este bug
        // por outro igual.
        await tx`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES (${file.hashes[0]}, ${file.when})
        `;
      });

      console.log(`[repair] ${row.tag} aplicada e registrada (created_at=${file.when}).`);
    }

    console.log(`\nReparo concluído. Rode db:migrate:status para conferir.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
