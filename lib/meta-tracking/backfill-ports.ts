/**
 * A composição do backfill: liga o orquestrador (`run-backfill.ts`) aos
 * executores de verdade.
 *
 * Quase tudo que o backfill precisa do mundo é o que o coletor diário já
 * precisava — token, contas, listagem, fetch profundo, estado anterior,
 * gravação do delta —, e reusar as portas dele é o que garante que as duas
 * coletas escrevam a MESMA coisa no banco. Só três peças são próprias do
 * backfill:
 *
 * 1. **O run é de outro tipo** (`kind = "backfill"`), e fecha MESCLANDO o
 *    `summary` — é lá que mora o progresso por conta.
 * 2. **A série vem pelo job assíncrono da Meta**, não pela consulta síncrona:
 *    treze meses num relatório síncrono estouram o teto de linhas antes de
 *    começar.
 * 3. **O progresso é lido e gravado por conta**, que é o que faz a retomada.
 * 4. **A conta é reivindicada antes de ser tocada** (ticket 10), porque agora há
 *    mais de um disparador: o workflow da conexão e o dreno manual.
 */

import {
  claimBackfillAccount,
  finishBackfillRun,
  loadBackfillProgress,
  saveBackfillProgress,
} from "@/lib/db/meta-tracking-backfill-queries";
import { createTrackingRun } from "@/lib/db/meta-tracking-collector-queries";
import { upsertDailyMetricRows } from "@/lib/db/meta-tracking-metrics-queries";
import { fetchAccountInsightsAsync } from "@/lib/meta-tracking/async-insights-ports";
import {
  collectDailyMetrics as runDailyMetricsStep,
  type DailyMetricsPorts,
} from "@/lib/meta-tracking/collect-daily-metrics";
import { createDailyCollectionPorts } from "@/lib/meta-tracking/daily-collection-ports";
import type { BackfillPorts } from "@/lib/meta-tracking/run-backfill";

/**
 * As portas do passo de resultados no backfill: job assíncrono de um lado,
 * Postgres do outro.
 *
 * Sem `fetchInsightsAsync`: o recuo por volume já ENTRA pelo assíncrono, e o
 * degrau seguinte dele é partir o período ao meio — não existe "mais
 * assíncrono" para onde recuar.
 */
const BACKFILL_METRICS_PORTS: DailyMetricsPorts = {
  fetchInsights: fetchAccountInsightsAsync,
  upsertRows: upsertDailyMetricRows,
};

export function createBackfillPorts(): BackfillPorts {
  const daily = createDailyCollectionPorts();

  return {
    now: daily.now,
    getManagedCampaignPrefix: daily.getManagedCampaignPrefix,
    listUsersWithMeta: daily.listUsersWithMeta,
    getCredentials: daily.getCredentials,
    listAdAccounts: daily.listAdAccounts,
    listEntities: daily.listEntities,
    fetchConfigs: daily.fetchConfigs,
    loadAccountState: daily.loadAccountState,
    persistAccountDelta: daily.persistAccountDelta,

    claimAccount: claimBackfillAccount,
    loadProgress: loadBackfillProgress,
    saveProgress: saveBackfillProgress,

    collectMetrics: (args) => runDailyMetricsStep(BACKFILL_METRICS_PORTS, args),

    createRun: createTrackingRun,
    finishRun: finishBackfillRun,
  };
}
