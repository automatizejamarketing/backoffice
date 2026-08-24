/**
 * Fundação de tracking de campanhas Meta — invariantes do schema (fase F1 de
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * O que este arquivo protege NÃO é "as colunas existem" — disso o typecheck já
 * dá conta. São as três decisões do §4 do plano que só o banco consegue
 * sustentar sozinho, e cuja perda seria silenciosa:
 *
 *  1. Os uniques que tornam a coleta idempotente. O coletor roda várias vezes na
 *     mesma madrugada (múltiplos disparos do cron drenando lotes): sem eles,
 *     reexecutar duplica versão, métrica, cobertura e atividade.
 *  2. Os campos voláteis moram na versão mas ficam FORA do hash da configuração.
 *     Se as colunas sumirem, o coletor perde onde gravá-los e a alternativa
 *     vira colocá-los no hash — aí toda pausa em cascata do pai nasce como
 *     "versão nova" e o histórico de configuração passa a mentir.
 *  3. O índice parcial da versão vigente (`valid_to IS NULL`), que é o caminho
 *     de leitura de "estado da entidade em qualquer data".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";

import {
  metaTrackingAccountCoverage,
  metaTrackingActivityEvent,
  metaTrackingChangeEvent,
  metaTrackingConfigVersion,
  metaTrackingCreative,
  metaTrackingDailyMetric,
  metaTrackingInsightsStrategy,
  metaTrackingRun,
} from "../lib/db/schema";

function columnNames(table: PgTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function findIndex(table: PgTable, name: string) {
  const found = getTableConfig(table).indexes.find(
    (index) => index.config.name === name,
  );
  assert.ok(
    found,
    `índice ${name} ausente em ${getTableConfig(table).name} (existem: ${getTableConfig(
      table,
    )
      .indexes.map((index) => index.config.name)
      .join(", ")})`,
  );
  return found;
}

function indexColumns(table: PgTable, name: string): string[] {
  return findIndex(table, name).config.columns.map(
    (column) => (column as { name?: string }).name ?? String(column),
  );
}

describe("meta tracking — tabelas do domínio", () => {
  it("nomeia as oito tabelas com o prefixo de domínio meta_tracking_", () => {
    assert.deepEqual(
      [
        metaTrackingConfigVersion,
        metaTrackingDailyMetric,
        metaTrackingChangeEvent,
        metaTrackingActivityEvent,
        metaTrackingRun,
        metaTrackingAccountCoverage,
        metaTrackingInsightsStrategy,
        metaTrackingCreative,
      ].map((table) => getTableConfig(table).name),
      [
        "meta_tracking_config_versions",
        "meta_tracking_daily_metrics",
        "meta_tracking_change_events",
        "meta_tracking_activity_events",
        "meta_tracking_runs",
        "meta_tracking_account_coverage",
        "meta_tracking_insights_strategies",
        "meta_tracking_creatives",
      ],
    );
  });
});

describe("meta tracking — idempotência da coleta", () => {
  it("uma versão por (nível, entidade, hash, vigência)", () => {
    const index = findIndex(
      metaTrackingConfigVersion,
      "meta_tracking_config_versions_entity_hash_valid_from_unique",
    );
    assert.equal(index.config.unique, true);
    assert.deepEqual(
      indexColumns(
        metaTrackingConfigVersion,
        "meta_tracking_config_versions_entity_hash_valid_from_unique",
      ),
      ["entity_level", "entity_id", "config_hash", "valid_from"],
    );
  });

  it("uma métrica por (nível, entidade, dia)", () => {
    const index = findIndex(
      metaTrackingDailyMetric,
      "meta_tracking_daily_metrics_entity_date_unique",
    );
    assert.equal(index.config.unique, true);
    assert.deepEqual(
      indexColumns(
        metaTrackingDailyMetric,
        "meta_tracking_daily_metrics_entity_date_unique",
      ),
      ["entity_level", "entity_id", "metric_date"],
    );
  });

  it("uma cobertura por (conta, dia) — é ela que sustenta o claim onlyStale", () => {
    const index = findIndex(
      metaTrackingAccountCoverage,
      "meta_tracking_account_coverage_account_date_unique",
    );
    assert.equal(index.config.unique, true);
    assert.deepEqual(
      indexColumns(
        metaTrackingAccountCoverage,
        "meta_tracking_account_coverage_account_date_unique",
      ),
      ["account_id", "business_date"],
    );
  });

  it("uma atividade por chave composta de dedup", () => {
    const index = findIndex(
      metaTrackingActivityEvent,
      "meta_tracking_activity_events_dedup_hash_unique",
    );
    assert.equal(index.config.unique, true);
    assert.deepEqual(
      indexColumns(
        metaTrackingActivityEvent,
        "meta_tracking_activity_events_dedup_hash_unique",
      ),
      ["dedup_hash"],
    );
    // O poll do /activities usa `since = -48h` de propósito: a sobreposição só é
    // inofensiva porque a chave de dedup absorve a repetição. Os cinco campos
    // que a compõem precisam estar todos gravados para que o hash seja
    // reconstruível a partir da linha.
    const columns = columnNames(metaTrackingActivityEvent);
    for (const column of [
      "account_id",
      "event_type",
      "event_time",
      "object_id",
      "actor_id",
    ]) {
      assert.ok(
        columns.includes(column),
        `${column} compõe a chave de dedup e precisa estar na tabela`,
      );
    }
  });
});

describe("meta tracking — versões de configuração (SCD2)", () => {
  it("guarda os campos voláteis fora do hash", () => {
    const columns = columnNames(metaTrackingConfigVersion);
    for (const column of [
      "effective_status",
      "budget_remaining",
      "learning_stage_info",
      "issues_info",
      "updated_time_meta",
      "last_budget_toggling_time",
    ]) {
      assert.ok(columns.includes(column), `coluna volátil ${column} ausente`);
    }
  });

  it("tem índice parcial da versão vigente (valid_to IS NULL)", () => {
    const index = findIndex(
      metaTrackingConfigVersion,
      "meta_tracking_config_versions_current_idx",
    );
    assert.ok(
      index.config.where,
      "o índice da versão vigente precisa ser parcial",
    );
    assert.deepEqual(
      indexColumns(
        metaTrackingConfigVersion,
        "meta_tracking_config_versions_current_idx",
      ),
      ["entity_level", "entity_id"],
    );
  });

  it("carrega config integral, hash e a marca de gerenciada por versão", () => {
    const columns = columnNames(metaTrackingConfigVersion);
    for (const column of [
      "config",
      "config_hash",
      "is_managed",
      "valid_from",
      "valid_to",
      "version_number",
      "last_confirmed_at",
    ]) {
      assert.ok(columns.includes(column), `coluna ${column} ausente`);
    }
  });
});

describe("meta tracking — stream unificado de ações", () => {
  it("liga versão anterior, versão nova, evento cru e log legado", () => {
    const columns = columnNames(metaTrackingChangeEvent);
    for (const column of [
      "change_kind",
      "changed_fields",
      "from_config_version_id",
      "to_config_version_id",
      "source",
      "actor_email",
      "actor_name_meta",
      "note",
      "occurred_at",
      "detected_at",
      "activity_event_id",
      "legacy_edit_log_table",
      "legacy_edit_log_id",
    ]) {
      assert.ok(columns.includes(column), `coluna ${column} ausente`);
    }
  });

  it("indexa a busca por entidade, conta, usuário e origem", () => {
    for (const name of [
      "meta_tracking_change_events_entity_occurred_idx",
      "meta_tracking_change_events_account_occurred_idx",
      "meta_tracking_change_events_user_occurred_idx",
      "meta_tracking_change_events_source_idx",
    ]) {
      findIndex(metaTrackingChangeEvent, name);
    }
  });
});

describe("meta tracking — operação e criativos", () => {
  it("a cobertura carrega moeda e timezone da conta (números batem com o Gerenciador)", () => {
    const columns = columnNames(metaTrackingAccountCoverage);
    for (const column of [
      "status",
      "currency",
      "timezone_name",
      "entities_seen",
      "api_calls_used",
      "error_message",
    ]) {
      assert.ok(columns.includes(column), `coluna ${column} ausente`);
    }
  });

  it("o criativo é chaveado pelo id da Meta — um snapshot por criativo", () => {
    const config = getTableConfig(metaTrackingCreative);
    assert.deepEqual(
      config.columns.filter((column) => column.primary).map((c) => c.name),
      ["id"],
    );
  });

  it("o run registra tipo, gatilho, status e contadores", () => {
    const columns = columnNames(metaTrackingRun);
    for (const column of [
      "kind",
      "triggered_by",
      "status",
      "started_at",
      "completed_at",
      "error_message",
      "summary",
    ]) {
      assert.ok(columns.includes(column), `coluna ${column} ausente`);
    }
  });
});
