/**
 * Registra migrations gêmeas já cobertas pelo outro projeto antes do drizzle.
 *
 * Frontend e backoffice compartilham `drizzle.__drizzle_migrations`, mas os
 * journals históricos têm tags e `when` diferentes. Quando o outro projeto já
 * criou todos os objetos de uma migration e levantou a marca d'água, o drizzle
 * tenta executar o SQL novamente em vez de reconhecer a mesma mudança. Este
 * preflight registra somente essas migrations históricas conhecidas, sem editar
 * os arquivos SQL ou reescrever o histórico existente.
 */
import postgres from "postgres";

import {
  extractDdlTargets,
  readMigrationJournal,
} from "./migration-audit";

type Sql = ReturnType<typeof postgres>;

/** Migrations de Produto que existem com tags/when gêmeos no outro projeto. */
export const LEGACY_PRODUCT_TWIN_TAGS = new Set([
  "0075_mercadopago_expert_connections",
  "0078_product_refund_requests",
  "0079_product_refund_operations",
  "0080_product_refund_balance_cases",
  "0082_product_dispute_defences",
  "0069_mercadopago_expert_connections",
  "0072_product_refund_requests",
  "0073_product_refund_operations",
  "0074_product_refund_balance_cases",
  "0075_product_dispute_defences",
]);

export async function recordCoveredLegacyProductMigrations(
  sql: Sql,
  migrationsFolder: string,
): Promise<void> {
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
  `) as unknown as Array<{ hash: string; created_at: string | null }>;
  const appliedHashes = new Set(applied.map((row) => row.hash));
  const watermark = applied.reduce(
    (max, row) => Math.max(max, Number(row.created_at ?? 0)),
    0,
  );

  const tables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `) as unknown as Array<{ table_name: string }>;
  const columns = (await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
  `) as unknown as Array<{ table_name: string; column_name: string }>;
  const existingTables = new Set(tables.map((row) => row.table_name));
  const existingColumns = new Set(
    columns.map((row) => `${row.table_name}.${row.column_name}`),
  );

  for (const file of readMigrationJournal(migrationsFolder)) {
    if (!LEGACY_PRODUCT_TWIN_TAGS.has(file.tag)) continue;
    if (file.when > watermark) continue;
    if (file.hashes.some((hash) => appliedHashes.has(hash))) continue;

    const targets = extractDdlTargets(file.sql);
    const covered =
      targets.tables.length > 0 || targets.columns.length > 0
        ? targets.tables.every((table) => existingTables.has(table)) &&
          targets.columns.every(({ table, column }) =>
            existingColumns.has(`${table}.${column}`),
          )
        : false;
    if (!covered) continue;

    const [hash] = file.hashes;
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT ${hash}, ${file.when}
      WHERE NOT EXISTS (
        SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
      )
    `;
    appliedHashes.add(hash);
  }
}
