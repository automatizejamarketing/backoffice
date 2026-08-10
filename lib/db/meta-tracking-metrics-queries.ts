/**
 * Gravação da série diária de resultados em Postgres (§4.2 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Só I/O. Quem decide o que é uma linha, qual é a janela e o que já congelou é
 * `lib/meta-tracking/daily-metrics.ts`; quem traduz as famílias cruas nas
 * colunas conhecidas é `lib/meta-tracking/metric-columns.ts`; quem coordena os
 * níveis é `lib/meta-tracking/collect-daily-metrics.ts`.
 *
 * ## As duas regras que este arquivo carrega
 *
 * 1. **Upsert, nunca delete.** A unicidade `(entity_level, entity_id,
 *    metric_date)` é o que faz a re-coleta da janela móvel atualizar o dia em vez
 *    de duplicá-lo — a atribuição da Meta muda retroativamente por 28 dias, e é
 *    o mesmo dia que precisa ser reescrito.
 * 2. **Dia final não é reescrito.** O `setWhere` recusa o UPDATE quando a linha
 *    já está marcada como final. É a garantia em código de que o backfill (que
 *    grava dias antigos como imutáveis) e a coleta diária não brigam pelo mesmo
 *    dia — e de que um valor congelado nunca regride.
 *
 * `first_captured_at` fica de fora do UPDATE de propósito: ele responde "desde
 * quando este dia existe no nosso histórico", e sobrescrevê-lo a cada re-coleta
 * apagaria essa resposta.
 */

import { asc, eq, getTableColumns, gt, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { metaTrackingDailyMetric } from "@/lib/db/schema";
import type { DailyMetricRow } from "@/lib/meta-tracking/daily-metrics";
import type { MetricColumns } from "@/lib/meta-tracking/metric-columns";

/**
 * Linhas por comando. Cada linha ocupa ~54 parâmetros desde que as métricas
 * conhecidas viraram colunas; 400 × 54 ainda fica bem abaixo do teto de 65.535
 * parâmetros do Postgres, com folga para as próximas promoções.
 */
const UPSERT_BATCH_SIZE = 400;

/**
 * O valor que o INSERT tentou gravar, para o UPDATE do conflito. Um upsert em
 * lote não pode repetir os valores literais linha a linha — `excluded` é como o
 * Postgres expõe "a linha que estava chegando". Os nomes são literais fixos
 * deste módulo; nada vindo da Meta entra aqui.
 */
function excluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

/**
 * O que o UPDATE do conflito NÃO reescreve:
 *
 * - `id` e a tripla de unicidade (`entity_level`, `entity_id`, `metric_date`) —
 *   mexer nelas seria trocar de linha, não atualizar esta;
 * - `first_captured_at`, que responde "desde quando este dia existe no nosso
 *   histórico" e seria apagado a cada re-coleta;
 * - `last_refreshed_at`, que recebe o instante DESTA gravação, não o valor que
 *   estava chegando.
 */
const CONFLICT_UNTOUCHED_COLUMNS = new Set([
  "id",
  "entity_level",
  "entity_id",
  "metric_date",
  "first_captured_at",
  "last_refreshed_at",
]);

/**
 * "Reescreve tudo que chegou", derivado da própria tabela: a próxima métrica
 * promovida a coluna passa a ser atualizada pelo upsert sem ninguém precisar
 * lembrar de acrescentá-la aqui — que é justamente o erro que deixaria a
 * re-coleta da janela móvel gravando um valor velho para sempre.
 */
function conflictUpdateSet(
  refreshedAt: Date,
): PgUpdateSetSource<typeof metaTrackingDailyMetric> {
  const set: Record<string, unknown> = { lastRefreshedAt: refreshedAt };

  for (const [field, column] of Object.entries(
    getTableColumns(metaTrackingDailyMetric),
  )) {
    if (CONFLICT_UNTOUCHED_COLUMNS.has(column.name)) continue;
    set[field] = excluded(column.name);
  }

  return set as PgUpdateSetSource<typeof metaTrackingDailyMetric>;
}

/**
 * Grava a série diária. Devolve quantas linhas foram de fato inseridas ou
 * atualizadas — as recusadas por já estarem finais não contam, e é assim que o
 * contador do run diz o que mudou em vez de quantas linhas foram enviadas.
 */
export async function upsertDailyMetricRows(
  rows: readonly DailyMetricRow[],
): Promise<number> {
  let written = 0;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    if (batch.length === 0) continue;

    const refreshedAt = new Date();
    const affected = await db
      .insert(metaTrackingDailyMetric)
      // Toda chave de `DailyMetricRow` é uma coluna desta tabela — inclusive as
      // ~32 métricas promovidas —, então listá-las aqui uma a uma só criaria um
      // lugar a mais para esquecer a próxima.
      .values(
        batch.map((row) => ({
          ...row,
          firstCapturedAt: refreshedAt,
          lastRefreshedAt: refreshedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [
          metaTrackingDailyMetric.entityLevel,
          metaTrackingDailyMetric.entityId,
          metaTrackingDailyMetric.metricDate,
        ],
        set: conflictUpdateSet(refreshedAt),
        setWhere: eq(metaTrackingDailyMetric.isFinal, false),
      })
      .returning({ id: metaTrackingDailyMetric.id });

    written += affected.length;
  }

  return written;
}

/**
 * Uma linha já gravada, com só o que a promoção retroativa precisa ler. Os
 * nomes são os de `MetricColumnSource` de propósito: é isso que deixa o
 * backfill chamar a MESMA função de extração que a escrita, sem tradução no
 * meio (uma tradução seria o lugar onde as duas divergiriam).
 */
export type PromotableMetricRow = {
  id: string;
  spend: string | null;
  actions: unknown;
  actionValues: unknown;
  costPerResult: unknown;
  purchaseRoas: unknown;
  websitePurchaseRoas: unknown;
  videoActions: unknown;
  estimatedAdRecallers: number | null;
};

/**
 * O próximo lote da promoção retroativa, por keyset em `id`.
 *
 * Keyset e não OFFSET: a varredura pode levar horas e o OFFSET reordenaria a
 * cada inserção da coleta diária, pulando linhas em silêncio.
 */
export async function listMetricRowsForPromotion(args: {
  afterId?: string;
  limit: number;
}): Promise<PromotableMetricRow[]> {
  return db
    .select({
      id: metaTrackingDailyMetric.id,
      spend: metaTrackingDailyMetric.spend,
      actions: metaTrackingDailyMetric.actions,
      actionValues: metaTrackingDailyMetric.actionValues,
      costPerResult: metaTrackingDailyMetric.costPerResult,
      purchaseRoas: metaTrackingDailyMetric.purchaseRoas,
      websitePurchaseRoas: metaTrackingDailyMetric.websitePurchaseRoas,
      videoActions: metaTrackingDailyMetric.videoActions,
      estimatedAdRecallers: metaTrackingDailyMetric.estimatedAdRecallers,
    })
    .from(metaTrackingDailyMetric)
    .where(
      args.afterId ? gt(metaTrackingDailyMetric.id, args.afterId) : undefined,
    )
    .orderBy(asc(metaTrackingDailyMetric.id))
    .limit(args.limit);
}

/**
 * Escreve as colunas promovidas de um lote, uma linha por UPDATE.
 *
 * Três coisas que este UPDATE deliberadamente NÃO faz:
 *
 * - não olha `is_final` — promover não muda valor nenhum, só copia para coluna
 *   o que o jsonb da própria linha já dizia; recusar dias congelados deixaria
 *   justamente o histórico antigo de fora;
 * - não toca `last_refreshed_at` — não houve re-coleta, e mexer nele mentiria
 *   para a tela de operação;
 * - não usa `VALUES` em lote — a tabela nasce vazia e o passivo real é de
 *   dezenas de milhares de linhas; montar um `UPDATE … FROM (VALUES …)` com 33
 *   colunas e seus casts seria complexidade sem freguês.
 */
export async function applyPromotedMetricColumns(
  updates: ReadonlyArray<{ id: string; columns: MetricColumns }>,
): Promise<number> {
  let written = 0;

  for (const update of updates) {
    const affected = await db
      .update(metaTrackingDailyMetric)
      .set(update.columns)
      .where(eq(metaTrackingDailyMetric.id, update.id))
      .returning({ id: metaTrackingDailyMetric.id });

    written += affected.length;
  }

  return written;
}
