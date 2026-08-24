/**
 * A composição do coletor diário: liga o orquestrador
 * (`run-daily-collection.ts`) aos executores de verdade — Graph API em
 * `graph-collector-gateway.ts` e Postgres em
 * `lib/db/meta-tracking-collector-queries.ts`.
 *
 * Existe como arquivo separado porque é o único lugar do coletor que conhece os
 * dois mundos ao mesmo tempo. A rota de cron e o script manual importam daqui e
 * não sabem mais nada sobre como a coleta funciona; um teste importa o
 * orquestrador e monta as portas dele mesmo, sem tocar neste arquivo.
 */

import { getUsersWithMetaBusinessAccount } from "@/lib/db/admin-queries";
import { getBusinessOperatingRulesUncached } from "@/lib/db/business-queries";
import {
  createTrackingRun,
  finishTrackingRun,
  getAccountCoverageStatus,
  listKnownTrackedAccountIds,
  listKnownTrackedAccountsForPrecheck,
  loadInsightsStrategies,
  loadAccountTrackedState,
  loadRecentInternalChangeEvents,
  persistAccountTrackingDelta,
  saveInsightsStrategy,
  upsertAccountCoverage,
} from "@/lib/db/meta-tracking-collector-queries";
import {
  linkActivityMatches,
  loadEnrichableChangeEvents,
  upsertActivityEvents,
} from "@/lib/db/meta-tracking-activity-queries";
import {
  insertCreativeSnapshots,
  listUnknownCreativeIds,
} from "@/lib/db/meta-tracking-creative-queries";
import { markMetaConnectionNeedsReconnect } from "@/lib/db/meta-connection-queries";
import { upsertDailyMetricRows } from "@/lib/db/meta-tracking-metrics-queries";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { fetchAccountInsightsAsync } from "@/lib/meta-tracking/async-insights-ports";
import {
  collectActivityEvents as runActivityStep,
  type ActivityCollectionPorts,
} from "@/lib/meta-tracking/collect-activity-events";
import {
  collectCreativeSnapshots as runCreativeStep,
  type CreativeSnapshotPorts,
} from "@/lib/meta-tracking/collect-creative-snapshots";
import {
  collectDailyMetrics as runDailyMetricsStep,
  type DailyMetricsPorts,
} from "@/lib/meta-tracking/collect-daily-metrics";
import {
  fetchAccountActivities,
  fetchAccountInsights,
  fetchAdCreatives,
  fetchTrackedAdAccounts,
  fetchTrackedConfigs,
  listTrackedEntities,
} from "@/lib/meta-tracking/graph-collector-gateway";
import {
  assertDeadlineBudget,
  MIN_EXTERNAL_OPERATION_BUDGET_MS,
  MIN_PERSISTENCE_START_BUDGET_MS,
  type CollectionDeadline,
} from "@/lib/meta-tracking/collection-deadline";
import type {
  DailyCollectionPorts,
  TrackedUser,
} from "@/lib/meta-tracking/run-daily-collection";

/** Usuários por página ao varrer a base — o mesmo passo dos jobs existentes. */
const USER_PAGE_SIZE = 100;

/**
 * As portas do passo de resultados: Graph API de um lado, Postgres do outro.
 *
 * `fetchInsightsAsync` é o último degrau do recuo por volume de linhas (§5.6 do
 * plano): quando nem um dia único cabe na consulta síncrona, o relatório
 * assíncrono da Meta faz a janela inteira em troca de espera. Sem ele o nível
 * ficaria sem série no dia.
 */
const DAILY_METRICS_PORTS: DailyMetricsPorts = {
  fetchInsights: fetchAccountInsights,
  fetchInsightsAsync: fetchAccountInsightsAsync,
  loadInsightsStrategies,
  saveInsightsStrategy,
  upsertRows: upsertDailyMetricRows,
};

/** As portas do passo de audit trail, na mesma divisão. */
const ACTIVITY_PORTS: ActivityCollectionPorts = {
  fetchActivities: fetchAccountActivities,
  upsertActivityEvents,
  loadEnrichableChanges: loadEnrichableChangeEvents,
  linkActivityMatches,
};

/**
 * As portas do passo de criativos. A descoberta é uma varredura no banco (quais
 * `creative_id` das versões de anúncio ainda não têm snapshot), não um
 * subproduto do delta: é o que faz o passivo do backfill e o que falhou ontem
 * reaparecerem sozinhos.
 */
const CREATIVE_PORTS: CreativeSnapshotPorts = {
  listUnknownCreativeIds,
  fetchCreatives: fetchAdCreatives,
  insertCreatives: insertCreativeSnapshots,
};

/** Todos os usuários com conta Meta conectada, paginados até o fim. */
async function listAllUsersWithMeta(options: {
  userIds?: string[];
  deadline?: CollectionDeadline;
}): Promise<TrackedUser[]> {
  const users: TrackedUser[] = [];
  let page = 1;

  for (;;) {
    assertDeadlineBudget(
      options.deadline,
      "paginar usuários com Meta",
      MIN_PERSISTENCE_START_BUDGET_MS,
    );
    const batch = await getUsersWithMetaBusinessAccount({
      page,
      limit: USER_PAGE_SIZE,
      userIds: options.userIds,
    });
    users.push(...batch.users.map((row) => ({ id: row.id, email: row.email })));
    if (users.length >= batch.total || batch.users.length === 0) break;
    page += 1;
  }

  return users;
}

export function createDailyCollectionPorts(): DailyCollectionPorts {
  return {
    now: () => new Date(),

    // Sem o `unstable_cache` do Next de propósito: o coletor roda também fora do
    // runtime do Next (`scripts/collect-meta-tracking.ts`), onde o cache lança
    // `Invariant: incrementalCache missing`. É uma leitura por execução.
    getManagedCampaignPrefix: async (deadline) => {
      assertDeadlineBudget(
        deadline,
        "carregar regras de negócio",
        MIN_PERSISTENCE_START_BUDGET_MS,
      );
      return (await getBusinessOperatingRulesUncached()).managedCampaignNamePrefix;
    },

    listUsersWithMeta: listAllUsersWithMeta,

    getCredentials: async (userId, deadline) => {
      assertDeadlineBudget(
        deadline,
        "carregar credenciais Meta",
        MIN_PERSISTENCE_START_BUDGET_MS,
      );
      const result = await getUserAccessTokenByUserId(userId);
      if (!result.success) {
        return {
          ok: false,
          needsReconnect: result.error.needsReconnect === true,
          classification:
            result.error.statusCode >= 500
              ? "technical_failure"
              : "customer_action_required",
          message: result.error.message || "Cliente sem conta Meta conectada.",
        };
      }
      return {
        ok: true,
        credentials: {
          connectionId: result.connection.id,
          accessToken: result.accessToken,
          tokenKind: result.connection.tokenKind,
          bisuAppScopedId: result.connection.bisuAppScopedId,
          clientBusinessId: result.connection.clientBusinessId,
          connectionName: result.connection.name,
        },
      };
    },

    markConnectionNeedsReconnect: markMetaConnectionNeedsReconnect,

    listKnownAccountIds: listKnownTrackedAccountIds,

    listKnownAccountsForPrecheck: listKnownTrackedAccountsForPrecheck,

    // Duas etapas de propósito: o edge de contas atribuídas devolve a lista mas
    // não a timezone, e é a timezone da conta que define o "dia" da cobertura.
    listAdAccounts: async ({ credentials, deadline }) => {
      assertDeadlineBudget(
        deadline,
        "descobrir contas de anúncio",
        MIN_EXTERNAL_OPERATION_BUDGET_MS,
      );
      const identity = await getUserWithAdAccounts(credentials.accessToken, {
        tokenKind:
          credentials.tokenKind === "bisu" || credentials.tokenKind === "user"
            ? credentials.tokenKind
            : undefined,
        bisuAppScopedId: credentials.bisuAppScopedId,
        clientBusinessId: credentials.clientBusinessId,
        connectionName: credentials.connectionName,
        deadline,
      });
      const accountIds = (identity.adaccounts?.data ?? []).map(
        (account) => account.id,
      );
      const enriched = await fetchTrackedAdAccounts({
        accountIds,
        credentials,
        deadline,
      });
      return {
        accounts: enriched.accounts,
        usage: enriched.usage,
        apiCalls: enriched.apiCalls + 1,
      };
    },

    listEntities: listTrackedEntities,

    fetchConfigs: fetchTrackedConfigs,

    loadAccountState: loadAccountTrackedState,

    loadRecentInternalChanges: loadRecentInternalChangeEvents,

    getCoverageStatus: getAccountCoverageStatus,

    recordCoverage: upsertAccountCoverage,

    persistAccountDelta: persistAccountTrackingDelta,

    collectActivityEvents: (args) => runActivityStep(ACTIVITY_PORTS, args),

    collectDailyMetrics: (args) =>
      runDailyMetricsStep(DAILY_METRICS_PORTS, args),

    collectCreativeSnapshots: (args) => runCreativeStep(CREATIVE_PORTS, args),

    createRun: ({ triggeredBy, deadline }) =>
      createTrackingRun({ triggeredBy, deadline }),

    finishRun: finishTrackingRun,
  };
}
