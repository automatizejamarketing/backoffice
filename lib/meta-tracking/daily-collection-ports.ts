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
import { getBusinessOperatingRules } from "@/lib/db/business-queries";
import {
  createTrackingRun,
  finishTrackingRun,
  getAccountCoverageStatus,
  listKnownTrackedAccountIds,
  loadAccountTrackedState,
  loadRecentInternalChangeEvents,
  persistAccountTrackingDelta,
  upsertAccountCoverage,
} from "@/lib/db/meta-tracking-collector-queries";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import {
  fetchTrackedAdAccounts,
  fetchTrackedConfigs,
  listTrackedEntities,
} from "@/lib/meta-tracking/graph-collector-gateway";
import type {
  DailyCollectionPorts,
  TrackedUser,
} from "@/lib/meta-tracking/run-daily-collection";

/** Usuários por página ao varrer a base — o mesmo passo dos jobs existentes. */
const USER_PAGE_SIZE = 100;

/** Todos os usuários com conta Meta conectada, paginados até o fim. */
async function listAllUsersWithMeta(options: {
  userIds?: string[];
}): Promise<TrackedUser[]> {
  const users: TrackedUser[] = [];
  let page = 1;

  for (;;) {
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

    getManagedCampaignPrefix: async () =>
      (await getBusinessOperatingRules()).managedCampaignNamePrefix,

    listUsersWithMeta: listAllUsersWithMeta,

    getCredentials: async (userId) => {
      const result = await getUserAccessTokenByUserId(userId);
      if (!result.success) {
        return {
          ok: false,
          needsReconnect: result.error.needsReconnect === true,
          message: result.error.message || "Cliente sem conta Meta conectada.",
        };
      }
      return {
        ok: true,
        credentials: {
          accessToken: result.accessToken,
          tokenKind: result.connection.tokenKind,
          bisuAppScopedId: result.connection.bisuAppScopedId,
          clientBusinessId: result.connection.clientBusinessId,
          connectionName: result.connection.name,
        },
      };
    },

    listKnownAccountIds: listKnownTrackedAccountIds,

    // Duas etapas de propósito: o edge de contas atribuídas devolve a lista mas
    // não a timezone, e é a timezone da conta que define o "dia" da cobertura.
    listAdAccounts: async ({ credentials }) => {
      const identity = await getUserWithAdAccounts(credentials.accessToken, {
        tokenKind:
          credentials.tokenKind === "bisu" || credentials.tokenKind === "user"
            ? credentials.tokenKind
            : undefined,
        bisuAppScopedId: credentials.bisuAppScopedId,
        clientBusinessId: credentials.clientBusinessId,
        connectionName: credentials.connectionName,
      });
      const accountIds = (identity.adaccounts?.data ?? []).map(
        (account) => account.id,
      );
      const enriched = await fetchTrackedAdAccounts({
        accountIds,
        credentials,
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

    createRun: ({ triggeredBy }) => createTrackingRun({ triggeredBy }),

    finishRun: finishTrackingRun,
  };
}
