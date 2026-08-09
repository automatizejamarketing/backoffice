/**
 * Gravação da série diária de resultados em Postgres (§4.2 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Só I/O. Quem decide o que é uma linha, qual é a janela e o que já congelou é
 * `lib/meta-tracking/daily-metrics.ts`; quem coordena os níveis é
 * `lib/meta-tracking/collect-daily-metrics.ts`.
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

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { metaTrackingDailyMetric } from "@/lib/db/schema";
import type { DailyMetricRow } from "@/lib/meta-tracking/daily-metrics";

/**
 * Linhas por comando. Cada linha ocupa ~18 parâmetros; 400 deixa o comando bem
 * abaixo do teto de parâmetros do Postgres com folga para colunas futuras.
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
      .values(
        batch.map((row) => ({
          userId: row.userId,
          accountId: row.accountId,
          entityLevel: row.entityLevel,
          entityId: row.entityId,
          campaignId: row.campaignId,
          adsetId: row.adsetId,
          metricDate: row.metricDate,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          reach: row.reach,
          frequency: row.frequency,
          actions: row.actions,
          actionValues: row.actionValues,
          costPerActionType: row.costPerActionType,
          costPerResult: row.costPerResult,
          purchaseRoas: row.purchaseRoas,
          websitePurchaseRoas: row.websitePurchaseRoas,
          firstCapturedAt: refreshedAt,
          lastRefreshedAt: refreshedAt,
          isFinal: row.isFinal,
        })),
      )
      .onConflictDoUpdate({
        target: [
          metaTrackingDailyMetric.entityLevel,
          metaTrackingDailyMetric.entityId,
          metaTrackingDailyMetric.metricDate,
        ],
        set: {
          userId: excluded("user_id"),
          accountId: excluded("account_id"),
          campaignId: excluded("campaign_id"),
          adsetId: excluded("adset_id"),
          spend: excluded("spend"),
          impressions: excluded("impressions"),
          clicks: excluded("clicks"),
          reach: excluded("reach"),
          frequency: excluded("frequency"),
          actions: excluded("actions"),
          actionValues: excluded("action_values"),
          costPerActionType: excluded("cost_per_action_type"),
          costPerResult: excluded("cost_per_result"),
          purchaseRoas: excluded("purchase_roas"),
          websitePurchaseRoas: excluded("website_purchase_roas"),
          lastRefreshedAt: refreshedAt,
          isFinal: excluded("is_final"),
        },
        setWhere: eq(metaTrackingDailyMetric.isFinal, false),
      })
      .returning({ id: metaTrackingDailyMetric.id });

    written += affected.length;
  }

  return written;
}
