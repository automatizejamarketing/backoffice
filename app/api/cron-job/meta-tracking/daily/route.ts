import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { createDailyCollectionPorts } from "@/lib/meta-tracking/daily-collection-ports";
import {
  runDailyTrackingCollection,
  type DailyCollectionError,
  type DailyCollectionResult,
} from "@/lib/meta-tracking/run-daily-collection";
import {
  newCorrelationId,
  runWithMetaLogContextAsync,
} from "@/lib/observability/meta-log-context";
import { safeErrorSummary } from "@/lib/observability/meta-log-safety";

// 800 s é o máximo GA do plano Pro. O deadline interno total fica em 600 s
// (`DEFAULT_SOFT_DEADLINE_MS`): o trabalho normal para 30 s antes para gravar
// coverage + run, e os 200 s restantes são a última proteção para persistências
// já iniciadas, que o driver Postgres não cancela cooperativamente.
export const maxDuration = 800;

/**
 * Coleta diária de configuração das contas Meta conectadas (§5 e §10 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Roda na janela de madrugada (03:00–10:45 UTC ≈ 00:00–07:45 BRT, a cada
 * 15 min = 32 disparos), terminando antes da janela 11:00–12:15 UTC dos crons
 * de negócio — que falam com a MESMA Graph API e disputariam a cota. O
 * intervalo de 15 min é deliberadamente maior que o `maxDuration`: disparos
 * nunca se sobrepõem, e o claim de cobertura conta×dia não precisa ser
 * atômico. Cada disparo drena um LOTE de contas e para com folga do limite de
 * duração da plataforma; o disparo seguinte encontra as contas ainda
 * pendentes pela cobertura conta×dia e continua de onde parou. Rodar duas
 * vezes no mesmo dia não duplica nada — a conta já coberta é pulada e, quando
 * reprocessada, a configuração idêntica só atualiza `last_confirmed_at`.
 *
 * Dimensionamento (medido em staging, 2026-08-10): conta típica 11–15 s,
 * conta de ~2.400 entidades ~2 min. 32 disparos × 570 s de trabalho ≈ 18.240 s
 * por madrugada ≈ 1.300 contas típicas — folga para uma base de 1.000.
 */
function emitCronLog(
  event: string,
  payload: Record<string, unknown>,
  level: "info" | "error" = "info",
): void {
  const line = JSON.stringify({
    evt: "meta_tracking_cron",
    event,
    ts: new Date().toISOString(),
    level,
    ...payload,
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

function issueCounts(result: DailyCollectionResult): Record<string, number> {
  return {
    customerActionRequired: result.issuesCustomerActionRequired,
    externalTransient: result.issuesExternalTransient,
    degradedComponent: result.issuesDegradedComponent,
    internalFailure: result.issuesInternalFailure,
  };
}

function componentSummary(result: DailyCollectionResult) {
  return {
    discovery: {
      attempts: result.discoveryAttempts,
      failures: result.discoveryFailures,
    },
    listing: {
      paginationTruncated: result.listingPaginationTruncated,
    },
    activities: {
      attempted: result.activityAccountsAttempted,
      failed: result.activityAccountsFailed,
      paginationTruncated: result.activityPaginationTruncated,
    },
    insights: {
      attempted: result.insightsAccountsAttempted,
      failed: result.insightsAccountsFailed,
      levelsAbandoned: result.insightsLevelsAbandoned,
      campaignLevelsAbandoned: result.insightsCampaignLevelsAbandoned,
      adsetLevelsAbandoned: result.insightsAdsetLevelsAbandoned,
      adLevelsAbandoned: result.insightsAdLevelsAbandoned,
    },
    creatives: {
      attempted: result.creativeAccountsAttempted,
      failed: result.creativeAccountsFailed,
      fetched: result.creativesFetched,
      pending: result.creativesPending,
    },
  };
}

function logIssue(issue: DailyCollectionError): void {
  // Reconexão é estado operacional agregado no summary, não erro repetido por
  // usuário a cada tick. As outras categorias mantêm uma linha por ocorrência.
  if (issue.category === "customer_action_required") return;
  emitCronLog(
    "issue",
    {
      runId: issue.runId,
      category: issue.category,
      operation: issue.operation,
      entity: issue.entity,
      userRef: issue.userRef,
      accountRef: issue.accountRef,
      message: issue.message,
      error: issue.error,
    },
    "error",
  );
}

export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[meta-tracking-cron]");
  if (!auth.ok) return auth.response;

  return runWithMetaLogContextAsync(
    {
      correlationId: newCorrelationId(),
      app: "backoffice",
      route: "/api/cron-job/meta-tracking/daily",
    },
    runAuthorizedCollection,
  );
}

async function runAuthorizedCollection() {
  try {
    const result = await runDailyTrackingCollection(
      createDailyCollectionPorts(),
      {
        triggeredBy: "cron",
        onlyStale: true,
        // O rastro por conta existe para o pós-morte: se a plataforma matar a
        // invocação no limite de duração, o último "coletando" sem o "→ status"
        // correspondente é a conta que morreu no meio — sem isso a invocação
        // morta não deixa vestígio nenhum no log.
        onAccountStart: ({ runId, userRef, accountRef }) => {
          emitCronLog("account_started", { runId, userRef, accountRef });
        },
        onProgress: (progress) => {
          // Mantém o par start/finish por conta: se a plataforma matar a
          // invocação, somente a conta em voo fica sem término.
          emitCronLog(
            "account_finished",
            {
              runId: progress.runId,
              userRef: progress.userRef,
              accountRef: progress.accountRef,
              status: progress.status,
              metricRowsUpserted: progress.metricRowsUpserted,
              errorMessage: progress.errorMessage,
              error: progress.error,
            },
            progress.status === "failed" ? "error" : "info",
          );
        },
        onIssue: logIssue,
      },
    );

    emitCronLog("completed", {
      runId: result.runId,
      usersConsidered: result.usersConsidered,
      accountsSeen: result.accountsSeen,
      accountsProcessed: result.accountsProcessed,
      accountsCovered: result.accountsCovered,
      accountsPartial: result.accountsPartial,
      accountsSkipped: result.accountsSkipped,
      accountsSkippedReconnect: result.accountsSkippedReconnect,
      accountsFailed: result.accountsFailed,
      customerActionsRequired: result.customerActionsRequired,
      usersWithoutKnownAccounts: result.usersWithoutKnownAccounts,
      graphApiCalls: result.graphApiCalls,
      versionsCreated: result.versionsCreated,
      eventsCreated: result.eventsCreated,
      metricRowsUpserted: result.metricRowsUpserted,
      creativesFetched: result.creativesFetched,
      appRateLimitEvents: result.appRateLimitEvents,
      maxAppQuotaUtilizationPercent:
        result.maxAppQuotaUtilizationPercent,
      stoppedForAppQuota: result.stoppedForAppQuota,
      stoppedForBudget: result.stoppedForBudget,
      issues: issueCounts(result),
      components: componentSummary(result),
    });

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      usersConsidered: result.usersConsidered,
      accountsSeen: result.accountsSeen,
      accountsProcessed: result.accountsProcessed,
      accountsCovered: result.accountsCovered,
      accountsPartial: result.accountsPartial,
      accountsFailed: result.accountsFailed,
      accountsSkipped: result.accountsSkipped,
      accountsSkippedReconnect: result.accountsSkippedReconnect,
      accountsAlreadyCovered: result.accountsAlreadyCovered,
      customerActionsRequired: result.customerActionsRequired,
      usersWithoutKnownAccounts: result.usersWithoutKnownAccounts,
      entitiesSeen: result.entitiesSeen,
      graphApiCalls: result.graphApiCalls,
      versionsCreated: result.versionsCreated,
      eventsCreated: result.eventsCreated,
      versionsConfirmed: result.versionsConfirmed,
      activityEventsUpserted: result.activityEventsUpserted,
      activityEventsMatched: result.activityEventsMatched,
      metricRowsUpserted: result.metricRowsUpserted,
      metricSlicesDegraded: result.metricSlicesDegraded,
      /** Falhas de leitura da otimização; a coleta seguiu pelo caminho padrão. */
      metricStrategyLoadFailures: result.metricStrategyLoadFailures,
      /** Falhas de escrita da otimização; as métricas já estavam gravadas. */
      metricStrategySaveFailures: result.metricStrategySaveFailures,
      /** Snapshots de criativo gravados neste disparo (foto única por criativo). */
      creativesFetched: result.creativesFetched,
      creativesPending: result.creativesPending,
      /** Throttles observados cujo código identifica limite do app inteiro. */
      appRateLimitEvents: result.appRateLimitEvents,
      /** Maior percentual global anunciado nos headers desta invocação. */
      maxAppQuotaUtilizationPercent:
        result.maxAppQuotaUtilizationPercent,
      /** Verdadeiro = o breaker global deixou as próximas contas para outro cron. */
      stoppedForAppQuota: result.stoppedForAppQuota,
      /** Verdadeiro = ainda há base a cobrir; o próximo disparo continua. */
      stoppedForBudget: result.stoppedForBudget,
      issues: issueCounts(result),
      components: componentSummary(result),
      // Compatibilidade: o nome legado continua, mas agora só contém refs e
      // erros limitados; `sampleIssues` explicita a nova semântica.
      sampleErrors: result.errors.slice(0, 5),
      sampleIssues: result.errors.slice(0, 5),
    });
  } catch (error) {
    const safeError = safeErrorSummary(
      error,
      "Failed to run meta tracking collection",
    );
    emitCronLog(
      "failed",
      {
        category: "internal_failure",
        operation: "run",
        entity: "run",
        error: safeError,
      },
      "error",
    );
    return NextResponse.json(
      {
        error: safeError.message,
      },
      { status: 500 },
    );
  }
}
