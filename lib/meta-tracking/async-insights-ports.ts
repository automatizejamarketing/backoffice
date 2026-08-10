/**
 * A composição do job assíncrono de insights: liga a espera
 * (`async-insights-job.ts`) aos três executores de verdade do gateway.
 *
 * Existe como módulo próprio porque os dois caminhos precisam dele: o backfill
 * (§6 do plano `docs/plans/campaign-tracking-foundation.md`), que ENTRA por
 * aqui, e a coleta diária, que cai aqui como último recurso quando o teto de
 * linhas da consulta síncrona não cede nem no dia único (§5.6). Sem este
 * arquivo, uma das duas composições importaria a outra.
 */

import {
  runAsyncInsightsReport,
  type AsyncInsightsJobPorts,
} from "@/lib/meta-tracking/async-insights-job";
import {
  fetchInsightsReportRows,
  readInsightsReport,
  startInsightsReport,
} from "@/lib/meta-tracking/graph-collector-gateway";
import type {
  InsightsFetchArgs,
  InsightsFetchResult,
} from "@/lib/meta-tracking/collect-daily-metrics";

const ASYNC_INSIGHTS_JOB_PORTS: AsyncInsightsJobPorts = {
  startReport: startInsightsReport,
  readReport: readInsightsReport,
  fetchReportRows: fetchInsightsReportRows,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
};

/** Insights de um nível num período, pelo relatório assíncrono da Meta. */
export function fetchAccountInsightsAsync(
  args: InsightsFetchArgs,
): Promise<InsightsFetchResult> {
  return runAsyncInsightsReport(ASYNC_INSIGHTS_JOB_PORTS, args);
}
