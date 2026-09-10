/**
 * Invariantes do journal de migrations e da auditoria que o `db:migrate` roda
 * depois de migrar.
 *
 * O que este arquivo protege é a única coisa que o `drizzle-kit migrate` NÃO
 * verifica: que toda entrada do journal continua alcançável. Ele decide o que
 * rodar com `max(created_at) < when` — uma marca d'água só, e não o conjunto do
 * que já foi aplicado. Como este banco é compartilhado com
 * `../automatize-frontend` e os dois escrevem em `drizzle.__drizzle_migrations`,
 * uma entrada cujo `when` fique abaixo de uma marca já levantada por outra
 * branch some do radar em silêncio, com o comando saindo 0.
 *
 * Foi assim que `0044_meta_tracking_foundation` nunca criou as tabelas
 * `meta_tracking_*` em produção e a aba de marketing passou a dar 500 em
 * `/api/meta-marketing/[accountId]/tracking-history`.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  auditMigrations,
  extractDdlTargets,
  hashVariants,
  isBroken,
  readMigrationJournal,
  stripSqlComments,
  type MigrationFile,
} from "../lib/db/migration-audit";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function siblingFrontendMigrations(backofficeRoot: string): string | null {
  const dirName = basename(backofficeRoot);
  const suffix = dirName.startsWith("backoffice")
    ? dirName.slice("backoffice".length)
    : "";
  const candidates = [
    join(backofficeRoot, "..", `automatize-frontend${suffix}`, "lib", "db", "migrations"),
    join(backofficeRoot, "..", "automatize-frontend", "lib", "db", "migrations"),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

const siblingMigrations = siblingFrontendMigrations(root);

/**
 * Colisões `when` que já existiam quando a auditoria foi escrita. Todas são
 * pares em que os dois repositórios gastaram o mesmo `when` com migrations
 * DIFERENTES — exatamente a forma que deixa uma das duas inalcançável. Estão
 * fixadas aqui porque reescrever o `when` de migration já aplicada em algum
 * ambiente é pior que conviver com o registro histórico; o valor do teste é
 * barrar a colisão nova, não reabrir as velhas.
 */
const KNOWN_CROSS_REPO_COLLISIONS = new Set([
  "0004_old_maginty|0004_old_maginty",
  "0010_keen_ben_parker|0012_tranquil_scarlet_witch",
  "0027_onboarding_whatsapp_gate|0027_video_templates_max_duration",
  "0034_digital_products|0034_meta_oauth_auth_mode",
  "0039_customer_base_daily_snapshots|0042_product_funnel_events",
  "0046_proactivity_alerts|0054_marketplace_fee_checkout_channel",
  "0040_expert_platform_fee|0043_payments_reversal",
  // Product migrations created before the parity bridge. They are preserved
  // as history because changing an applied `when` can make Drizzle replay DDL.
  "0068_product_participation_bounds|0075_mercadopago_expert_connections",
  "0076_product_post_sale_costs|0084_product_post_sale_costs",
]);

/**
 * Older deploys already recorded these byte-identical files under different
 * `when` values. They remain as immutable history; the bridge added by this
 * ticket and the migration preflight make the Product pairs safe without
 * editing those historical files.
 */
const KNOWN_TWIN_WHEN_DRIFT = new Set([
  "0011_panoramic_iron_fist|0013_famous_wild_child",
  "0013_adset_dayparting_audit|0017_adset_dayparting_audit",
  "0014_progressive_onboarding|0018_progressive_onboarding",
  "0015_profile_reminder_banner|0019_profile_reminder_banner",
  "0016_company_locations|0020_company_locations",
  "0018_trackable_links|0022_trackable_links",
  "0019_users_created_at|0023_users_created_at",
  "0040_expert_platform_fee|0043_payments_reversal",
  "0040_payments_reversal|0043_payments_reversal",
  "0046_proactivity_alerts|0047_proactivity_alerts",
  "0040_expert_platform_fee|0048_expert_platform_fee",
  "0069_mercadopago_expert_connections|0075_mercadopago_expert_connections",
  "0072_product_refund_requests|0078_product_refund_requests",
  "0073_product_refund_operations|0079_product_refund_operations",
  "0074_product_refund_balance_cases|0080_product_refund_balance_cases",
  "0075_product_dispute_defences|0082_product_dispute_defences",
]);

function pairKey(left: string, right: string): string {
  return [left, right].sort().join("|");
}

function fakeFile(
  tag: string,
  when: number,
  sql: string,
): MigrationFile {
  return { tag, when, sql, hashes: hashVariants(sql) };
}

describe("journal de migrations", () => {
  const entries = readMigrationJournal(join(root, "lib", "db", "migrations"));

  it("cresce estritamente — dois `when` iguais tornam o segundo inalcançável", () => {
    for (let i = 1; i < entries.length; i += 1) {
      assert.ok(
        entries[i].when > entries[i - 1].when,
        `${entries[i].tag} (when=${entries[i].when}) não é maior que ` +
          `${entries[i - 1].tag} (when=${entries[i - 1].when})`,
      );
    }
  });

  it("não estreia colisão de `when` com o repositório irmão", (t) => {
    if (!siblingMigrations) {
      t.skip("automatize-frontend irmão não está presente");
      return;
    }

    const sibling = new Map(
      readMigrationJournal(siblingMigrations).map((file) => [file.when, file]),
    );

    for (const entry of entries) {
      const twin = sibling.get(entry.when);
      if (!twin) continue;

      // Mesmo `when` com conteúdo idêntico é o combinado: a migration é a mesma
      // e quem rodar primeiro aplica. O problema é mesmo `when` com SQL
      // diferente — aí uma das duas nunca roda.
      const sameMigration = entry.hashes.some((hash) =>
        twin.hashes.includes(hash),
      );
      if (sameMigration) continue;

      assert.ok(
        KNOWN_CROSS_REPO_COLLISIONS.has(pairKey(entry.tag, twin.tag)),
        `when=${entry.when} está gasto por backoffice/${entry.tag} e por ` +
          `frontend/${twin.tag}, que são migrations diferentes. Escolha outro ` +
          `\`when\` — uma das duas jamais será aplicada.`,
      );
    }
  });

  it("gêmeas byte-idênticas compartilham o mesmo when", (t) => {
    if (!siblingMigrations) {
      t.skip("automatize-frontend irmão não está presente");
      return;
    }

    const sibling = readMigrationJournal(siblingMigrations);
    const byHash = new Map<string, (typeof sibling)[number]>();
    for (const file of sibling) {
      for (const hash of file.hashes) {
        byHash.set(hash, file);
      }
    }

    for (const entry of entries) {
      const twin = entry.hashes
        .map((hash) => byHash.get(hash))
        .find((file) => file !== undefined);
      if (!twin) continue;

      if (
        Math.abs(twin.when - entry.when) <= 1 ||
        KNOWN_TWIN_WHEN_DRIFT.has(pairKey(entry.tag, twin.tag))
      ) {
        continue;
      }

      assert.equal(
        twin.when,
        entry.when,
        `${entry.tag} e ${twin.tag} são o mesmo SQL com when ` +
          `${entry.when} ≠ ${twin.when} — a segunda pode reaplicar ou sumir`,
      );
    }
  });

  it("mantém um `.sql` para cada entrada", () => {
    for (const entry of entries) {
      assert.ok(entry.sql.length > 0, `${entry.tag} está vazia`);
    }
  });
});

describe("extração de alvos de DDL", () => {
  it("ignora DDL citado em comentário", () => {
    const targets = extractDdlTargets(
      `-- Estritamente aditiva: sete CREATE TABLE novos, nenhum ALTER.
       /* CREATE TABLE bloco_comentado (id int); */
       CREATE TABLE IF NOT EXISTS "meta_tracking_runs" ("id" uuid);`,
    );

    assert.deepEqual(targets.tables, ["meta_tracking_runs"]);
  });

  it("preserva corpo de bloco $$ sem confundir com comentário", () => {
    const sql = `DO $$ BEGIN
        -- comentário interno
        CREATE TABLE IF NOT EXISTS "dentro_do_bloco" ("id" int);
      END $$;`;

    assert.ok(stripSqlComments(sql).includes("dentro_do_bloco"));
    assert.deepEqual(extractDdlTargets(sql).tables, ["dentro_do_bloco"]);
  });

  it("lê ALTER TABLE … ADD COLUMN", () => {
    const targets = extractDdlTargets(
      `ALTER TABLE "meta_tracking_daily_metrics" ADD COLUMN IF NOT EXISTS "leads" integer;`,
    );

    assert.deepEqual(targets.columns, [
      { table: "meta_tracking_daily_metrics", column: "leads" },
    ]);
  });
});

describe("hash do arquivo", () => {
  it("reconhece o mesmo arquivo em CRLF e em LF", () => {
    const lf = 'CREATE TABLE "t" ("id" int);\nSELECT 1;\n';
    const crlf = lf.replace(/\n/g, "\r\n");

    const shared = hashVariants(lf).filter((hash) =>
      hashVariants(crlf).includes(hash),
    );

    // `core.autocrlf=true` no Windows entrega CRLF; os hashes gravados no banco
    // vieram de checkouts LF. Sem essa equivalência a auditoria acusaria dezenas
    // de migrations aplicadas como se nunca tivessem rodado.
    assert.equal(shared.length, 2);
  });
});

describe("auditoria", () => {
  const foundation = fakeFile(
    "0044_foundation",
    1793200000000,
    `CREATE TABLE IF NOT EXISTS "meta_tracking_change_events" ("id" uuid);`,
  );
  const columns = fakeFile(
    "0045_columns",
    1793300000000,
    `ALTER TABLE "meta_tracking_change_events" ADD COLUMN IF NOT EXISTS "leads" integer;`,
  );

  const emptyDb = {
    existingTables: new Set<string>(),
    existingColumns: new Set<string>(),
  };

  it("marca como `skipped` o que ficou abaixo da marca d'água", () => {
    const [row] = auditMigrations({
      files: [foundation],
      appliedHashes: new Set(),
      watermark: 1793600000000,
      ...emptyDb,
    });

    assert.equal(row.state, "skipped");
    assert.deepEqual(row.missingTables, ["meta_tracking_change_events"]);
    assert.ok(isBroken(row), "skipped com tabela ausente é o bug em produção");
  });

  it("marca como `pending` o que ainda vai rodar", () => {
    const [row] = auditMigrations({
      files: [foundation],
      appliedHashes: new Set(),
      watermark: 1000,
      ...emptyDb,
    });

    assert.equal(row.state, "pending");
  });

  it("não acusa migration pulada cujo objeto o repositório irmão já criou", () => {
    const [row] = auditMigrations({
      files: [foundation],
      appliedHashes: new Set(),
      watermark: 1793600000000,
      existingTables: new Set(["meta_tracking_change_events"]),
      existingColumns: new Set(),
    });

    assert.equal(row.state, "skipped");
    assert.equal(isBroken(row), false);
  });

  it("enxerga a coluna faltante mesmo com a tabela ainda por criar", () => {
    // 0045 altera a tabela que a 0044 cria. Se a auditoria exigisse a tabela
    // existente para conferir a coluna, o reparo aplicaria só a 0044 e o
    // diagnóstico teria que ser refeito do zero na rodada seguinte.
    const rows = auditMigrations({
      files: [foundation, columns],
      appliedHashes: new Set(),
      watermark: 1793600000000,
      ...emptyDb,
    });

    assert.deepEqual(rows[1].missingColumns, [
      { table: "meta_tracking_change_events", column: "leads" },
    ]);
    assert.ok(isBroken(rows[1]));
  });

  it("ignora coluna de tabela que nenhuma migration pendente cria", () => {
    const dropped = fakeFile(
      "0021_drop",
      1780300000001,
      `ALTER TABLE "ai_chat_messages" ADD COLUMN IF NOT EXISTS "x" integer;`,
    );

    const [row] = auditMigrations({
      files: [dropped],
      appliedHashes: new Set(),
      watermark: 1793600000000,
      ...emptyDb,
    });

    assert.deepEqual(row.missingColumns, []);
    assert.equal(isBroken(row), false);
  });

  it("considera aplicada a entrada cujo hash está registrado", () => {
    const [row] = auditMigrations({
      files: [foundation],
      appliedHashes: new Set(foundation.hashes),
      watermark: 1793600000000,
      ...emptyDb,
    });

    assert.equal(row.state, "applied");
    assert.equal(isBroken(row), false);
  });
});
