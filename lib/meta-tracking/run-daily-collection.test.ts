import { describe, expect, test } from "bun:test";

import {
  runDailyTrackingCollection,
  type AccountCoverageRecord,
  type DailyCollectionPorts,
  type TrackedAdAccount,
} from "@/lib/meta-tracking/run-daily-collection";
import type { ListedEntity } from "@/lib/meta-tracking/daily-collection-plan";
import type { TrackingDelta } from "@/lib/meta-tracking/compute-tracking-delta";
import {
  UNKNOWN_QUOTA_USAGE,
  type QuotaUsage,
} from "@/lib/meta-tracking/quota-usage";
import {
  hashTrackedConfig,
  normalizeTrackedConfig,
} from "@/lib/meta-tracking/config-version";
import { MetaTokenInvalidError } from "@/lib/meta-business/error";
import {
  findMappedError,
  GraphApiError,
} from "@/lib/meta-business/error";
import {
  adsetConfigV25,
  campaignConfigV25,
  FIXTURE_ADSET_ID,
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_MANAGED_PREFIX,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";

const USER = { id: "8a1c0f4e-0000-4000-8000-000000000001", email: "cliente@exemplo.com" };
const ACCOUNT: TrackedAdAccount = {
  accountId: "act_998877665544332",
  name: "Conta principal",
  currency: "BRL",
  timezoneName: "America/Sao_Paulo",
};
const NOW = new Date("2026-08-09T08:05:00Z");

function graphThrottleError(code: number, subcode = 1504022): GraphApiError {
  return new GraphApiError({
    statusCode: 403,
    reason: findMappedError(code, subcode),
    data: {
      message: "Application request limit reached",
      type: "OAuthException",
      code,
      errorSubcode: subcode,
    },
  });
}

/** A listagem de uma conta com campanha e conjunto entregando. */
function activeListing(): ListedEntity[] {
  return [
    {
      entityLevel: "campaign",
      entityId: FIXTURE_CAMPAIGN_ID,
      name: campaignConfigV25().name as string,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: new Date("2026-08-08T13:12:44Z"),
    },
    {
      entityLevel: "adset",
      entityId: FIXTURE_ADSET_ID,
      name: adsetConfigV25().name as string,
      campaignId: FIXTURE_CAMPAIGN_ID,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: new Date("2026-08-08T13:12:45Z"),
    },
  ];
}

type Recorded = {
  coverage: AccountCoverageRecord[];
  deltas: TrackingDelta[];
  runs: Array<{ status: string; summary: Record<string, number> }>;
  graphCalls: string[];
  internalChangeWindows: Array<{ accountId: string; since: Date }>;
  metricCalls: Array<{ accountId: string; today: string; usage: QuotaUsage }>;
  activityCalls: Array<{ accountId: string; now: Date }>;
  creativeCalls: Array<{ accountId: string; usage: QuotaUsage }>;
};

function makePorts(overrides: Partial<DailyCollectionPorts> = {}): {
  ports: DailyCollectionPorts;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    coverage: [],
    deltas: [],
    runs: [],
    graphCalls: [],
    internalChangeWindows: [],
    metricCalls: [],
    activityCalls: [],
    creativeCalls: [],
  };

  const ports: DailyCollectionPorts = {
    now: () => NOW,
    getManagedCampaignPrefix: async () => FIXTURE_MANAGED_PREFIX,
    listUsersWithMeta: async () => [USER],
    getCredentials: async () => ({
      ok: true,
      credentials: {
        connectionId: "meta-connection-1",
        accessToken: "token-de-teste",
      },
    }),
    markConnectionNeedsReconnect: async () => {},
    listKnownAccountIds: async () => [ACCOUNT.accountId],
    // Vazio = pré-cheque inerte: cada teste que quiser o atalho o liga.
    listKnownAccountsForPrecheck: async () => [],
    listAdAccounts: async () => {
      recorded.graphCalls.push("listAdAccounts");
      return { accounts: [ACCOUNT], usage: UNKNOWN_QUOTA_USAGE, apiCalls: 1 };
    },
    listEntities: async () => {
      recorded.graphCalls.push("listEntities");
      return {
        entities: activeListing(),
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 3,
      };
    },
    fetchConfigs: async ({ chunks }) => {
      recorded.graphCalls.push("fetchConfigs");
      const configs = chunks.flatMap((chunk) =>
        chunk.entityIds.map((entityId) => ({
          entityLevel: chunk.entityLevel,
          entityId,
          config:
            chunk.entityLevel === "campaign"
              ? campaignConfigV25()
              : adsetConfigV25(),
        })),
      );
      return {
        configs,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: chunks.length,
        stoppedForQuota: false,
      };
    },
    loadAccountState: async () => [],
    loadRecentInternalChanges: async ({ accountId, since }) => {
      recorded.internalChangeWindows.push({ accountId, since });
      return [];
    },
    getCoverageStatus: async () => null,
    recordCoverage: async (record) => {
      recorded.coverage.push(record);
    },
    persistAccountDelta: async ({ delta }) => {
      recorded.deltas.push(delta);
      return {
        versionsCreated: delta.versions.length,
        eventsCreated: delta.events.length,
        versionsConfirmed: delta.confirmations.length,
        eventsLinked: delta.versionLinks.length,
      };
    },
    collectActivityEvents: async ({ accountId, now }) => {
      recorded.graphCalls.push("collectActivityEvents");
      recorded.activityCalls.push({ accountId, now });
      return {
        eventsUpserted: 9,
        eventsMatched: 2,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
        paginationTruncated: false,
      };
    },
    collectDailyMetrics: async ({ accountId, today, usage }) => {
      recorded.graphCalls.push("collectDailyMetrics");
      recorded.metricCalls.push({ accountId, today, usage });
      return {
        rowsUpserted: 87,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 3,
        stoppedForQuota: false,
        slicesDegraded: 0,
        strategyLoadFailures: 0,
        strategySaveFailures: 0,
        levelsAbandoned: [],
      };
    },
    collectCreativeSnapshots: async ({ accountId, usage }) => {
      recorded.graphCalls.push("collectCreativeSnapshots");
      recorded.creativeCalls.push({ accountId, usage });
      return {
        creativesFetched: 4,
        creativesPending: 0,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
        stoppedForQuota: false,
        appRateLimitEvents: 0,
        failureMessage: null,
      };
    },
    createRun: async () => "run-1",
    finishRun: async ({ status, summary }) => {
      recorded.runs.push({ status, summary });
    },
    ...overrides,
  };

  return { ports, recorded };
}

describe("runDailyTrackingCollection", () => {
  test("primeira coleta da conta cria versões, eventos e cobertura completa", async () => {
    const { ports, recorded } = makePorts();

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "script",
    });

    const [delta] = recorded.deltas;
    expect(delta.versions).toHaveLength(2);
    expect(delta.events.map((event) => event.changeKind)).toEqual([
      "created",
      "created",
    ]);
    expect(recorded.coverage).toHaveLength(1);
    expect(recorded.coverage[0]).toMatchObject({
      accountId: ACCOUNT.accountId,
      businessDate: "2026-08-09",
      status: "complete",
      currency: "BRL",
      timezoneName: "America/Sao_Paulo",
      entitiesSeen: 2,
    });
    expect(result.versionsCreated).toBe(2);
    expect(result.eventsCreated).toBe(2);
    expect(result.accountsCovered).toBe(1);
    expect(recorded.runs).toHaveLength(1);
    expect(recorded.runs[0].status).toBe("completed");
    expect(recorded.runs[0].summary).toMatchObject({
      accountsCovered: 1,
      versionsCreated: 2,
      eventsCreated: 2,
    });
  });

  test("a coleta pergunta pelas ações internas do último dia da conta", async () => {
    const { ports, recorded } = makePorts();

    await runDailyTrackingCollection(ports, { triggeredBy: "script" });

    expect(recorded.internalChangeWindows).toEqual([
      {
        accountId: ACCOUNT.accountId,
        since: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
      },
    ]);
  });

  test("mudança já registrada pelo backoffice liga a versão em vez de virar evento", async () => {
    const yesterdayCampaign = campaignConfigV25();
    const todayCampaign = campaignConfigV25({ daily_budget: "9000" });

    const { ports, recorded } = makePorts({
      listEntities: async () => ({
        entities: activeListing().slice(0, 1),
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 3,
      }),
      fetchConfigs: async () => ({
        configs: [
          {
            entityLevel: "campaign" as const,
            entityId: FIXTURE_CAMPAIGN_ID,
            config: todayCampaign,
          },
        ],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
        stoppedForQuota: false,
      }),
      loadAccountState: async () => [
        {
          entityLevel: "campaign",
          entityId: FIXTURE_CAMPAIGN_ID,
          lastEffectiveStatus: "ACTIVE",
          confirmedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
          currentVersion: {
            id: "8d0f5b2a-4c31-4d7e-9a10-6b5c4d3e2f11",
            versionNumber: 4,
            configHash: hashTrackedConfig(
              normalizeTrackedConfig(yesterdayCampaign),
            ),
            isManaged: true,
            config: yesterdayCampaign,
          },
        },
      ],
      loadRecentInternalChanges: async () => [
        {
          changeEventId: "b7c2e1d0-3a45-4f67-8901-2b3c4d5e6f70",
          entityLevel: "campaign",
          entityId: FIXTURE_CAMPAIGN_ID,
          changeKind: "config_change",
          changedFields: { daily_budget: { old: "5000", new: "9000" } },
          occurredAt: new Date(NOW.getTime() - 6 * 60 * 60 * 1000),
        },
      ],
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "script",
    });

    const [delta] = recorded.deltas;
    expect(delta.versions).toHaveLength(1);
    expect(delta.events).toEqual([]);
    expect(delta.versionLinks).toHaveLength(1);
    expect(result.eventsCreated).toBe(0);
    expect(result.eventsLinked).toBe(1);
    expect(recorded.runs[0].summary).toMatchObject({ eventsLinked: 1 });
  });

  test("a marca de Campanha Gerenciada é avaliada com o prefixo das regras do negócio", async () => {
    const { ports, recorded } = makePorts();

    await runDailyTrackingCollection(ports, { triggeredBy: "script" });

    const campaignVersion = recorded.deltas[0].versions.find(
      (version) => version.entityLevel === "campaign",
    );
    expect(campaignVersion?.isManaged).toBe(true);
  });

  test("rodar de novo no mesmo dia pula a conta já coberta sem tocar na Meta", async () => {
    const { ports, recorded } = makePorts({
      getCoverageStatus: async () => "complete",
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.graphCalls).toEqual(["listAdAccounts"]);
    expect(recorded.deltas).toHaveLength(0);
    expect(recorded.coverage).toHaveLength(0);
    expect(result.accountsAlreadyCovered).toBe(1);
    expect(result.accountsProcessed).toBe(0);
  });

  test("usuário 100% coberto no pré-cheque não gasta nem a descoberta de contas", async () => {
    const { ports, recorded } = makePorts({
      listKnownAccountsForPrecheck: async () => [
        { accountId: ACCOUNT.accountId, timezoneName: ACCOUNT.timezoneName ?? null },
      ],
      getCoverageStatus: async () => "complete",
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    // Nenhuma chamada à Meta — nem a listagem de contas (2–3 chamadas/usuário
    // que os 32 disparos noturnos pagavam mesmo com tudo já coberto).
    expect(recorded.graphCalls).toEqual([]);
    expect(result.accountsAlreadyCovered).toBe(1);
    expect(result.accountsProcessed).toBe(0);
  });

  test("pré-cheque com conta descoberta segue para a descoberta normal", async () => {
    const { ports, recorded } = makePorts({
      listKnownAccountsForPrecheck: async () => [
        { accountId: ACCOUNT.accountId, timezoneName: ACCOUNT.timezoneName ?? null },
      ],
      getCoverageStatus: async () => null,
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.graphCalls[0]).toBe("listAdAccounts");
    expect(result.accountsProcessed).toBe(1);
  });

  test("coleta manual com --all ignora o pré-cheque", async () => {
    const { ports, recorded } = makePorts({
      listKnownAccountsForPrecheck: async () => [
        { accountId: ACCOUNT.accountId, timezoneName: ACCOUNT.timezoneName ?? null },
      ],
      getCoverageStatus: async () => "complete",
    });

    await runDailyTrackingCollection(ports, {
      triggeredBy: "manual",
      onlyStale: false,
    });

    expect(recorded.graphCalls[0]).toBe("listAdAccounts");
  });

  test("cobertura parcial fica pendente: o disparo seguinte completa a conta", async () => {
    const { ports, recorded } = makePorts({
      getCoverageStatus: async () => "partial",
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(result.accountsProcessed).toBe(1);
    expect(recorded.coverage[0].status).toBe("complete");
  });

  test("indisponibilidade transitória vira parcial e o cron seguinte retoma sem retry imediato", async () => {
    let coverageStatus: AccountCoverageRecord["status"] | null = null;
    let listingAttempts = 0;
    const coverage: AccountCoverageRecord[] = [];
    const outage = Object.assign(
      new Error("O serviço da Meta está temporariamente indisponível."),
      {
        name: "GraphApiError",
        errorReturn: {
          statusCode: 503,
          reason: { isTransient: true },
          data: { code: 2 },
        },
      },
    );
    const { ports } = makePorts({
      getCoverageStatus: async () => coverageStatus,
      listEntities: async () => {
        listingAttempts += 1;
        if (listingAttempts === 1) throw outage;
        return {
          entities: activeListing(),
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 3,
        };
      },
      recordCoverage: async (record) => {
        coverageStatus = record.status;
        coverage.push(record);
      },
    });

    const firstRun = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(listingAttempts).toBe(1);
    expect(firstRun.accountsPartial).toBe(1);
    expect(coverage[0]).toMatchObject({
      status: "partial",
      errorMessage:
        "O serviço da Meta está temporariamente indisponível. [code=2]",
    });

    const nextRun = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(listingAttempts).toBe(2);
    expect(nextRun.accountsCovered).toBe(1);
    expect(coverage.map((row) => row.status)).toEqual(["partial", "complete"]);
  });

  test("configuração idêntica à vigente não abre versão nem evento — só confirma", async () => {
    const campaign = campaignConfigV25();
    const { ports, recorded } = makePorts({
      loadAccountState: async () => [
        {
          entityLevel: "campaign",
          entityId: FIXTURE_CAMPAIGN_ID,
          lastEffectiveStatus: "ACTIVE",
          confirmedAt: new Date("2026-08-08T08:00:00Z"),
          currentVersion: {
            id: "version-1",
            versionNumber: 1,
            // O hash real é calculado pela costura; aqui basta que a
            // configuração vigente seja a mesma que a Meta devolve hoje.
            configHash: "",
            isManaged: true,
            config: campaign,
          },
        },
      ],
      listEntities: async () => ({
        entities: activeListing().filter(
          (entity) => entity.entityLevel === "campaign",
        ),
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 3,
      }),
      fetchConfigs: async () => ({
        configs: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            config: campaign,
          },
        ],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
        stoppedForQuota: false,
      }),
    });

    // Com o hash vigente igual ao de hoje, a costura só confirma.
    const { hashTrackedConfig, normalizeTrackedConfig } = await import(
      "@/lib/meta-tracking/config-version"
    );
    const state = await ports.loadAccountState({
      userId: USER.id,
      accountId: ACCOUNT.accountId,
    });
    state[0].currentVersion!.configHash = hashTrackedConfig(
      normalizeTrackedConfig(campaign),
    );
    ports.loadAccountState = async () => state;

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.deltas[0].versions).toHaveLength(0);
    expect(recorded.deltas[0].events).toHaveLength(0);
    expect(recorded.deltas[0].confirmations).toHaveLength(1);
    expect(result.versionsCreated).toBe(0);
  });

  test("estado novo da listagem vira transição a partir do estado anterior carregado", async () => {
    const { ports, recorded } = makePorts({
      loadAccountState: async () => [
        {
          entityLevel: "campaign",
          entityId: FIXTURE_CAMPAIGN_ID,
          lastEffectiveStatus: "ACTIVE",
          confirmedAt: new Date("2026-08-08T08:00:00Z"),
          currentVersion: null,
        },
      ],
      listEntities: async () => ({
        entities: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            name: campaignConfigV25().name as string,
            status: "PAUSED",
            effectiveStatus: "PAUSED",
          },
        ],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 3,
      }),
    });

    await runDailyTrackingCollection(ports, { triggeredBy: "cron" });

    expect(recorded.deltas[0].events).toHaveLength(1);
    expect(recorded.deltas[0].events[0]).toMatchObject({
      changeKind: "status_transition",
      changedFields: { effective_status: { old: "ACTIVE", new: "PAUSED" } },
    });
    expect(recorded.deltas[0].versions).toHaveLength(0);
  });

  test("reconexão pendente vira skipped_reconnect sem contaminar falhas técnicas", async () => {
    const { ports, recorded } = makePorts({
      getCredentials: async () => ({
        ok: false,
        needsReconnect: true,
        message: "A conexão com o Facebook expirou e precisa ser refeita.",
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.graphCalls).toEqual([]);
    expect(recorded.coverage).toHaveLength(1);
    expect(recorded.coverage[0]).toMatchObject({
      accountId: ACCOUNT.accountId,
      status: "skipped_reconnect",
      errorMessage: "A conexão com o Facebook expirou e precisa ser refeita.",
    });
    expect(result.accountsSkipped).toBe(1);
    expect(result.accountsSkippedReconnect).toBe(1);
    expect(result.customerActionsRequired).toBe(1);
    expect(result.errors).toEqual([]);
    expect(recorded.runs[0].status).toBe("completed");
    expect(recorded.runs[0].summary).toMatchObject({
      accountsSkippedReconnect: 1,
      customerActionsRequired: 1,
      issuesCustomerActionRequired: 1,
      issuesInternalFailure: 0,
    });
  });

  test("reconexão já registrada no dia não regrava a mesma cobertura", async () => {
    const { ports, recorded } = makePorts({
      getCredentials: async () => ({
        ok: false,
        needsReconnect: true,
        message: "A conexão com o Facebook expirou e precisa ser refeita.",
      }),
      getCoverageStatus: async () => "skipped_reconnect",
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage).toHaveLength(0);
    expect(result.accountsAlreadyCovered).toBe(1);
    expect(result.accountsSkipped).toBe(0);
    expect(result.customerActionsRequired).toBe(1);
    expect(recorded.runs[0].status).toBe("completed");
  });

  test("reconexão usa o dia e timezone conhecidos da conta", async () => {
    const { ports, recorded } = makePorts({
      getCredentials: async () => ({
        ok: false,
        needsReconnect: true,
        message: "Reconexão pendente.",
      }),
      listKnownAccountsForPrecheck: async () => [
        {
          accountId: ACCOUNT.accountId,
          timezoneName: "Pacific/Honolulu",
        },
      ],
      listKnownAccountIds: async () => {
        throw new Error("fallback de IDs não deveria ser consultado");
      },
    });

    await runDailyTrackingCollection(ports, { triggeredBy: "cron" });

    expect(recorded.coverage[0]).toMatchObject({
      accountId: ACCOUNT.accountId,
      businessDate: "2026-08-08",
      timezoneName: "Pacific/Honolulu",
      status: "skipped_reconnect",
    });
  });

  test("token quebrado de usuário nunca coletado fica visível sem virar falha técnica", async () => {
    const { ports, recorded } = makePorts({
      getCredentials: async () => ({
        ok: false,
        needsReconnect: true,
        message: "Reconexão pendente.",
      }),
      listKnownAccountIds: async () => [],
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage).toHaveLength(0);
    expect(result.usersWithoutKnownAccounts).toBe(1);
    expect(result.customerActionsRequired).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(recorded.runs[0].status).toBe("completed");
  });

  test("falha técnica ao obter credencial continua deixando a run amarela", async () => {
    const { ports, recorded } = makePorts({
      getCredentials: async () => ({
        ok: false,
        needsReconnect: false,
        classification: "technical_failure",
        message: "Falha interna ao descriptografar a credencial.",
      }),
      listKnownAccountIds: async () => [],
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(result.customerActionsRequired).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("descriptografar");
    expect(recorded.runs[0].status).toBe("completed_with_errors");
  });

  for (const code of [190, 102]) {
    test(`Graph ${code} mid-flight marca a conexão e não reconsulta as demais contas`, async () => {
      const secondAccount: TrackedAdAccount = {
        accountId: "act_112233445566778",
        name: "Segunda conta",
        currency: "BRL",
        timezoneName: "America/Sao_Paulo",
      };
      let listEntitiesCalls = 0;
      const marked: Array<{
        userId: string;
        connectionId: string;
        code: number;
        subcode?: number;
      }> = [];
      const { ports, recorded } = makePorts({
        listAdAccounts: async () => ({
          accounts: [ACCOUNT, secondAccount],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        }),
        listEntities: async () => {
          listEntitiesCalls += 1;
          throw new MetaTokenInvalidError(
            "Sessão invalidada pela Meta.",
            code,
            code === 190 ? 460 : undefined,
          );
        },
        markConnectionNeedsReconnect: async (input: {
          userId: string;
          connectionId: string;
          code: number;
          subcode?: number;
        }) => {
          marked.push(input);
        },
      } as Partial<DailyCollectionPorts>);

      const result = await runDailyTrackingCollection(ports, {
        triggeredBy: "cron",
      });

      expect(listEntitiesCalls).toBe(1);
      expect(marked).toEqual([
        {
          userId: USER.id,
          connectionId: "meta-connection-1",
          code,
          ...(code === 190 ? { subcode: 460 } : {}),
        },
      ]);
      expect(recorded.coverage.map((row) => row.status)).toEqual([
        "skipped_reconnect",
        "skipped_reconnect",
      ]);
      expect(result.accountsSkipped).toBe(2);
      expect(result.accountsFailed).toBe(0);
      expect(result.customerActionsRequired).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(recorded.runs[0].status).toBe("completed");
    });
  }

  test("cota apertada interrompe a conta com cobertura parcial e guarda o que já veio", async () => {
    const { ports, recorded } = makePorts({
      fetchConfigs: async ({ chunks }) => ({
        configs: chunks.slice(0, 1).flatMap((chunk) =>
          chunk.entityIds.map((entityId) => ({
            entityLevel: chunk.entityLevel,
            entityId,
            config: campaignConfigV25(),
          })),
        ),
        usage: { utilizationPercent: 87, estimatedRegainMs: null },
        apiCalls: 1,
        stoppedForQuota: true,
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage[0]).toMatchObject({ status: "partial" });
    expect(recorded.deltas[0].versions.length).toBeGreaterThan(0);
    expect(result.accountsPartial).toBe(1);
    expect(recorded.runs[0].status).toBe("completed");
  });

  test("cota já apertada na listagem nem chega a pedir configuração", async () => {
    const { ports, recorded } = makePorts({
      listEntities: async () => ({
        entities: activeListing(),
        usage: { utilizationPercent: 95, estimatedRegainMs: null },
        apiCalls: 3,
      }),
    });

    await runDailyTrackingCollection(ports, { triggeredBy: "cron" });

    expect(recorded.graphCalls).not.toContain("fetchConfigs");
    expect(recorded.coverage[0]).toMatchObject({ status: "partial" });
  });

  test("code 4 abre o circuit breaker da run; contas seguintes aguardam e o cron seguinte retoma", async () => {
    const otherAccount: TrackedAdAccount = {
      accountId: "act_112233445566778",
      name: "Segunda conta",
      currency: "BRL",
      timezoneName: "America/Sao_Paulo",
    };
    let throttleFirstAttempt = true;
    const attemptedAccounts: string[] = [];
    const { ports, recorded } = makePorts({
      listAdAccounts: async () => ({
        accounts: [ACCOUNT, otherAccount],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
      listEntities: async ({ accountId }) => {
        attemptedAccounts.push(accountId);
        if (accountId === ACCOUNT.accountId && throttleFirstAttempt) {
          throttleFirstAttempt = false;
          throw graphThrottleError(4);
        }
        return {
          entities: activeListing(),
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 3,
        };
      },
    });
    const coverageByAccount = new Map<string, AccountCoverageRecord["status"]>();
    const recordCoverage = ports.recordCoverage;
    ports.recordCoverage = async (record) => {
      coverageByAccount.set(record.accountId, record.status);
      await recordCoverage(record);
    };
    ports.getCoverageStatus = async ({ accountId }) =>
      coverageByAccount.get(accountId) ?? null;

    const throttledRun = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(attemptedAccounts).toEqual([ACCOUNT.accountId]);
    expect(recorded.coverage.map((row) => row.status)).toEqual(["partial"]);
    expect(throttledRun.stoppedForAppQuota).toBe(true);
    expect(throttledRun.stoppedForBudget).toBe(false);
    expect(throttledRun.appRateLimitEvents).toBe(1);
    expect(recorded.runs[0].summary).toMatchObject({
      accountsPartial: 1,
      appRateLimitEvents: 1,
      appQuotaStops: 1,
    });

    const resumedRun = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(attemptedAccounts).toEqual([
      ACCOUNT.accountId,
      ACCOUNT.accountId,
      otherAccount.accountId,
    ]);
    expect(recorded.coverage.map((row) => row.status)).toEqual([
      "partial",
      "complete",
      "complete",
    ]);
    expect(resumedRun.stoppedForAppQuota).toBe(false);
    expect(resumedRun.appRateLimitEvents).toBe(0);
    expect(resumedRun.accountsCovered).toBe(2);
  });

  test("header global acima de 80% para a run antes da conta seguinte", async () => {
    const otherAccount: TrackedAdAccount = {
      accountId: "act_112233445566778",
      name: "Segunda conta",
      currency: "BRL",
      timezoneName: "America/Sao_Paulo",
    };
    const attemptedAccounts: string[] = [];
    const { ports, recorded } = makePorts({
      listAdAccounts: async () => ({
        accounts: [ACCOUNT, otherAccount],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
      listEntities: async ({ accountId }) => {
        attemptedAccounts.push(accountId);
        return {
          entities: activeListing(),
          usage:
            accountId === ACCOUNT.accountId
              ? {
                  utilizationPercent: 84,
                  estimatedRegainMs: null,
                  appUtilizationPercent: 84,
                }
              : UNKNOWN_QUOTA_USAGE,
          apiCalls: 3,
        };
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(attemptedAccounts).toEqual([ACCOUNT.accountId]);
    expect(recorded.coverage.map((row) => row.status)).toEqual(["partial"]);
    expect(result.stoppedForAppQuota).toBe(true);
    expect(result.appRateLimitEvents).toBe(0);
    expect(result.maxAppQuotaUtilizationPercent).toBe(84);
    expect(recorded.runs[0].summary).toMatchObject({
      appRateLimitEvents: 0,
      appQuotaStops: 1,
      maxAppQuotaUtilizationPercent: 84,
    });
  });

  test("throttle restrito à conta não bloqueia contas independentes", async () => {
    const otherAccount: TrackedAdAccount = {
      accountId: "act_112233445566778",
      name: "Segunda conta",
      currency: "BRL",
      timezoneName: "America/Sao_Paulo",
    };
    const attemptedAccounts: string[] = [];
    const { ports, recorded } = makePorts({
      listAdAccounts: async () => ({
        accounts: [ACCOUNT, otherAccount],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
      listEntities: async ({ accountId }) => {
        attemptedAccounts.push(accountId);
        if (accountId === ACCOUNT.accountId) throw graphThrottleError(80004);
        return {
          entities: activeListing(),
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 3,
        };
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(attemptedAccounts).toEqual([
      ACCOUNT.accountId,
      otherAccount.accountId,
    ]);
    expect(recorded.coverage.map((row) => row.status)).toEqual([
      "partial",
      "complete",
    ]);
    expect(result.stoppedForAppQuota).toBe(false);
    expect(result.appRateLimitEvents).toBe(0);
  });

  test("erro em uma conta não derruba as outras e o run termina com erros", async () => {
    const otherAccount: TrackedAdAccount = {
      accountId: "act_112233445566778",
      name: "Segunda conta",
      currency: "BRL",
      timezoneName: "America/Sao_Paulo",
    };
    const { ports, recorded } = makePorts({
      listAdAccounts: async () => ({
        accounts: [ACCOUNT, otherAccount],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
      listEntities: async ({ accountId }) => {
        if (accountId === ACCOUNT.accountId) {
          throw new Error("Meta devolveu 500 para a listagem");
        }
        return {
          entities: activeListing(),
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 3,
        };
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage.map((row) => row.status)).toEqual([
      "failed",
      "complete",
    ]);
    expect(result.accountsFailed).toBe(1);
    expect(result.accountsCovered).toBe(1);
    expect(result.errors[0].message).toContain("500");
    expect(recorded.runs[0].status).toBe("completed_with_errors");
  });

  test("o rastro de progresso preserva diagnóstico sem expor ids crus", async () => {
    // O contrato de observabilidade: `onAccountStart` marca a conta em voo
    // (pós-morte de invocação morta pela plataforma) e `onProgress` entrega o
    // motivo e um erro limitado com stack da conta que não fechou.
    const otherAccount: TrackedAdAccount = {
      accountId: "act_112233445566778",
      name: "Segunda conta",
      currency: "BRL",
      timezoneName: "America/Sao_Paulo",
    };
    const boom = new Error("Meta devolveu 500 para a listagem");
    const { ports } = makePorts({
      listAdAccounts: async () => ({
        accounts: [ACCOUNT, otherAccount],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
      listEntities: async ({ accountId }) => {
        if (accountId === ACCOUNT.accountId) throw boom;
        return {
          entities: activeListing(),
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 3,
        };
      },
    });

    const started: string[] = [];
    const progressed: {
      accountRef: string;
      status: string;
      errorMessage: string | null;
      error?: unknown;
    }[] = [];

    await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
      onAccountStart: ({ accountRef }) => started.push(accountRef),
      onProgress: ({ accountRef, status, errorMessage, error }) =>
        progressed.push({ accountRef, status, errorMessage, error }),
    });

    expect(started).toHaveLength(2);
    expect(started[0]).toMatch(/^account-[a-f0-9]{12}$/);
    expect(started[1]).toMatch(/^account-[a-f0-9]{12}$/);
    expect(started[0]).not.toBe(started[1]);
    expect(JSON.stringify(started)).not.toContain(ACCOUNT.accountId);
    expect(JSON.stringify(started)).not.toContain(otherAccount.accountId);

    const failed = progressed.find((p) => p.status === "failed");
    expect(failed?.status).toBe("failed");
    expect(failed?.errorMessage).toContain("500");
    expect(failed?.error).toMatchObject({
      name: "Error",
      message: "Meta devolveu 500 para a listagem",
    });

    const covered = progressed.find((p) => p.status === "complete");
    expect(covered?.status).toBe("complete");
    expect(covered?.errorMessage).toBeNull();
    expect(covered?.error).toBeUndefined();
  });

  test("o lote drena até o limite da invocação e deixa o resto para o próximo disparo", async () => {
    const accounts: TrackedAdAccount[] = Array.from({ length: 5 }, (_, i) => ({
      accountId: `act_00000000000000${i}`,
      name: `Conta ${i}`,
      currency: "BRL",
      timezoneName: "America/Sao_Paulo",
    }));
    const { ports, recorded } = makePorts({
      listAdAccounts: async () => ({
        accounts,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
      maxAccounts: 2,
    });

    expect(recorded.coverage).toHaveLength(2);
    expect(result.stoppedForBudget).toBe(true);
    expect(result.accountsProcessed).toBe(2);
  });

  test("prazo da invocação estourado encerra o disparo sem matar o run", async () => {
    let clock = new Date("2026-08-09T08:00:00Z").getTime();
    const started: string[] = [];
    const accounts: TrackedAdAccount[] = Array.from({ length: 3 }, (_, i) => ({
      accountId: `act_00000000000000${i}`,
      name: `Conta ${i}`,
      currency: "BRL",
      timezoneName: "America/Sao_Paulo",
    }));
    const { ports, recorded } = makePorts({
      now: () => new Date(clock),
      listAdAccounts: async () => ({
        accounts,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
      listEntities: async () => {
        clock += 100_000;
        return {
          entities: activeListing(),
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 3,
        };
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
      softDeadlineMs: 150_000,
      onAccountStart: ({ accountRef }) => started.push(accountRef),
    });

    // A segunda conta não começa com apenas 20 s antes do deadline de trabalho.
    expect(recorded.coverage).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatch(/^account-[a-f0-9]{12}$/);
    expect(result.stoppedForBudget).toBe(true);
    expect(recorded.runs[0].status).toBe("completed");
    expect(recorded.runs[0].summary.stoppedForBudget).toBe(1);
  });

  test("deadline alcançado dentro da conta preserva checkpoint e fecha o run explicitamente", async () => {
    let clock = new Date("2026-08-09T08:00:00Z").getTime();
    const { ports, recorded } = makePorts({
      now: () => new Date(clock),
      listEntities: async () => {
        // A listagem começou com orçamento, mas terminou depois do deadline de
        // trabalho. Nenhuma etapa cara seguinte pode nascer a partir daqui.
        clock += 151_000;
        return {
          entities: activeListing(),
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 3,
        };
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
      softDeadlineMs: 180_000,
    });

    expect(recorded.graphCalls).toEqual(["listAdAccounts"]);
    expect(recorded.deltas).toHaveLength(0);
    expect(recorded.coverage).toHaveLength(1);
    expect(recorded.coverage[0]).toMatchObject({ status: "partial" });
    expect(recorded.coverage[0].errorMessage).toMatch(/orçamento|deadline/i);
    expect(result.stoppedForBudget).toBe(true);
    expect(recorded.runs).toHaveLength(1);
    expect(recorded.runs[0]).toMatchObject({
      status: "completed",
      summary: { stoppedForBudget: 1 },
    });
  });

  test("falha antes do primeiro lote marca o run como falho em vez de deixá-lo pendurado", async () => {
    const { ports, recorded } = makePorts({
      listUsersWithMeta: async () => {
        throw new Error("Postgres indisponível");
      },
    });

    await expect(
      runDailyTrackingCollection(ports, { triggeredBy: "cron" }),
    ).rejects.toThrow("Postgres indisponível");

    expect(recorded.runs).toHaveLength(1);
    expect(recorded.runs[0].status).toBe("failed");
    expect(recorded.runs[0].summary).toMatchObject({ accountsCovered: 0 });
  });

  test("a série diária é coletada no dia da conta e o contador entra no resumo do run", async () => {
    const { ports, recorded } = makePorts();

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.metricCalls).toEqual([
      {
        accountId: ACCOUNT.accountId,
        today: "2026-08-09",
        usage: UNKNOWN_QUOTA_USAGE,
      },
    ]);
    expect(result.metricRowsUpserted).toBe(87);
    expect(recorded.runs[0].summary).toMatchObject({ metricRowsUpserted: 87 });
    // Listagem (3) + dois lotes de configuração (2) + audit trail (1) +
    // insights (3) + criativos (1): as chamadas dos passos entram na conta da
    // cobertura.
    expect(recorded.coverage[0].apiCallsUsed).toBe(3 + 2 + 1 + 3 + 1);
  });

  test("as métricas vêm depois da configuração — o dia só é gravado uma vez", async () => {
    const { ports, recorded } = makePorts();

    await runDailyTrackingCollection(ports, { triggeredBy: "cron" });

    // Criativos por último de propósito: é a única coleta que não perece
    // (criativo é imutável), então é a primeira a ceder a vez quando a cota
    // aperta.
    expect(recorded.graphCalls).toEqual([
      "listAdAccounts",
      "listEntities",
      "fetchConfigs",
      "collectActivityEvents",
      "collectDailyMetrics",
      "collectCreativeSnapshots",
    ]);
  });

  test("conta interrompida por cota na configuração não gasta chamada com métricas", async () => {
    const { ports, recorded } = makePorts({
      listEntities: async () => ({
        entities: activeListing(),
        usage: { utilizationPercent: 95, estimatedRegainMs: null },
        apiCalls: 3,
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.metricCalls).toEqual([]);
    expect(result.metricRowsUpserted).toBe(0);
    expect(recorded.coverage[0]).toMatchObject({ status: "partial" });
  });

  test("cota estourada durante as métricas deixa a conta parcial e guarda o que veio", async () => {
    const { ports, recorded } = makePorts({
      collectDailyMetrics: async () => ({
        rowsUpserted: 12,
        usage: { utilizationPercent: 91, estimatedRegainMs: null },
        apiCalls: 2,
        stoppedForQuota: true,
        slicesDegraded: 0,
        strategyLoadFailures: 0,
        strategySaveFailures: 0,
        levelsAbandoned: [],
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage[0]).toMatchObject({ status: "partial" });
    expect(result.metricRowsUpserted).toBe(12);
    expect(result.accountsPartial).toBe(1);
  });

  test("nível abandonado por volume aparece no run sem tirar a conta do dia", async () => {
    const { ports, recorded } = makePorts({
      collectDailyMetrics: async () => ({
        rowsUpserted: 40,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 6,
        stoppedForQuota: false,
        slicesDegraded: 3,
        strategyLoadFailures: 0,
        strategySaveFailures: 0,
        levelsAbandoned: ["ad"],
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    // A cobertura continua completa: reinsistir hoje só multiplicaria o erro
    // que a própria Meta devolveu.
    expect(recorded.coverage[0]).toMatchObject({ status: "complete" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("ad");
    expect(recorded.runs[0].status).toBe("completed_with_errors");
    // O fatiamento é sinal de conta encostando no teto de linhas da Meta.
    expect(recorded.runs[0].summary).toMatchObject({ metricSlicesDegraded: 3 });
  });

  test("falhas fail-soft da estratégia ficam estruturadas sem sujar os erros", async () => {
    const { ports, recorded } = makePorts({
      collectDailyMetrics: async () => ({
        rowsUpserted: 40,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 4,
        stoppedForQuota: false,
        slicesDegraded: 1,
        strategyLoadFailures: 1,
        strategySaveFailures: 2,
        levelsAbandoned: [],
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage[0]).toMatchObject({ status: "complete" });
    expect(result.errors).toEqual([]);
    expect(result).toMatchObject({
      metricStrategyLoadFailures: 1,
      metricStrategySaveFailures: 2,
    });
    expect(recorded.runs[0].summary).toMatchObject({
      metricStrategyLoadFailures: 1,
      metricStrategySaveFailures: 2,
    });
  });

  test("falha na coleta de métricas não desfaz a configuração já gravada", async () => {
    const { ports, recorded } = makePorts({
      collectDailyMetrics: async () => {
        throw new Error("Meta devolveu 500 para insights");
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.deltas[0].versions).toHaveLength(2);
    expect(recorded.coverage[0]).toMatchObject({ status: "failed" });
    expect(result.versionsCreated).toBe(2);
    expect(result.metricRowsUpserted).toBe(0);
  });

  test("o snapshot de criativos roda com a cota já gasta e entra no resumo do run", async () => {
    const { ports, recorded } = makePorts();

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.creativeCalls).toEqual([
      { accountId: ACCOUNT.accountId, usage: UNKNOWN_QUOTA_USAGE },
    ]);
    expect(result.creativesFetched).toBe(4);
    expect(recorded.runs[0].summary).toMatchObject({
      creativesFetched: 4,
      creativesPending: 0,
    });
  });

  test("falha no snapshot de criativos não derruba a cobertura da conta", async () => {
    const { ports, recorded } = makePorts({
      collectCreativeSnapshots: async () => {
        throw new Error("Postgres recusou a varredura de criativos");
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    // Criativo é imutável: a varredura de amanhã encontra os mesmos ids.
    expect(recorded.coverage[0]).toMatchObject({ status: "complete" });
    expect(result.accountsCovered).toBe(1);
    expect(result.metricRowsUpserted).toBe(87);
    expect(result.creativesFetched).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("criativos");
  });

  test("lote de criativos recusado pela Meta vira erro no run e contador de pendentes", async () => {
    const { ports, recorded } = makePorts({
      collectCreativeSnapshots: async () => ({
        creativesFetched: 50,
        creativesPending: 12,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 2,
        stoppedForQuota: false,
        appRateLimitEvents: 0,
        failureMessage: "(#100) Unsupported get request",
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage[0]).toMatchObject({ status: "complete" });
    expect(result.creativesFetched).toBe(50);
    expect(result.creativesPending).toBe(12);
    expect(result.errors[0].message).toContain("Unsupported get request");
    expect(recorded.runs[0].summary).toMatchObject({ creativesPending: 12 });
  });

  test("conta parcial por cota não gasta chamada com criativos", async () => {
    const { ports, recorded } = makePorts({
      collectDailyMetrics: async () => ({
        rowsUpserted: 12,
        usage: { utilizationPercent: 91, estimatedRegainMs: null },
        apiCalls: 2,
        stoppedForQuota: true,
        slicesDegraded: 0,
        strategyLoadFailures: 0,
        strategySaveFailures: 0,
        levelsAbandoned: [],
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.creativeCalls).toEqual([]);
    expect(result.creativesFetched).toBe(0);
    expect(recorded.coverage[0]).toMatchObject({ status: "partial" });
  });

  test("o audit trail é consultado depois do delta gravado e entra no resumo do run", async () => {
    const { ports, recorded } = makePorts();

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    // O enriquecimento liga autor e horário a ações que já existem: pedir o
    // audit trail antes de gravar o delta não teria a que ligar.
    expect(recorded.graphCalls.indexOf("collectActivityEvents")).toBeGreaterThan(
      recorded.graphCalls.indexOf("fetchConfigs"),
    );
    expect(recorded.activityCalls).toEqual([
      { accountId: ACCOUNT.accountId, now: NOW },
    ]);
    expect(result.activityEventsUpserted).toBe(9);
    expect(result.activityEventsMatched).toBe(2);
    expect(recorded.runs[0].summary).toMatchObject({
      activityEventsUpserted: 9,
      activityEventsMatched: 2,
    });
  });

  test("quota global observada no audit trail impede Insights na mesma conta", async () => {
    const { ports, recorded } = makePorts({
      collectActivityEvents: async ({ accountId, now }) => {
        recorded.graphCalls.push("collectActivityEvents");
        recorded.activityCalls.push({ accountId, now });
        return {
          eventsUpserted: 3,
          eventsMatched: 1,
          usage: {
            utilizationPercent: 83,
            estimatedRegainMs: null,
            appUtilizationPercent: 83,
          },
          apiCalls: 1,
          paginationTruncated: false,
        };
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.metricCalls).toEqual([]);
    expect(recorded.creativeCalls).toEqual([]);
    expect(recorded.coverage[0]).toMatchObject({ status: "partial" });
    expect(result.stoppedForAppQuota).toBe(true);
    expect(result.maxAppQuotaUtilizationPercent).toBe(83);
  });

  test("falha do audit trail não derruba a cobertura: a coleta segue e o enriquecimento fica pendente", async () => {
    const { ports, recorded } = makePorts({
      collectActivityEvents: async () => {
        throw new Error("Meta devolveu 500 para activities");
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    // A ação detectada pelo diff já está gravada; o que faltou foi só o autor.
    expect(recorded.coverage[0]).toMatchObject({ status: "complete" });
    expect(result.accountsCovered).toBe(1);
    expect(result.versionsCreated).toBe(2);
    expect(result.metricRowsUpserted).toBe(87);
    expect(result.activityEventsMatched).toBe(0);
    // Fica visível no run — silêncio seria pior do que a falha.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Audit trail");
    expect(recorded.runs[0].status).toBe("completed_with_errors");
  });

  test("conta interrompida por cota na configuração não gasta chamada com o audit trail", async () => {
    const { ports, recorded } = makePorts({
      listEntities: async () => ({
        entities: activeListing(),
        usage: { utilizationPercent: 95, estimatedRegainMs: null },
        apiCalls: 3,
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.activityCalls).toEqual([]);
    expect(result.activityEventsUpserted).toBe(0);
    expect(recorded.coverage[0]).toMatchObject({ status: "partial" });
  });

  test("falha de descoberta fica estruturada no run sem inventar cobertura", async () => {
    const discoveryError = Object.assign(new Error("Meta temporariamente indisponível"), {
      errorReturn: {
        reason: { isTransient: true },
        data: { code: 2, errorSubcode: 99, fbtraceId: "trace-discovery" },
      },
    });
    const { ports, recorded } = makePorts({
      listAdAccounts: async () => {
        throw discoveryError;
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage).toEqual([]);
    expect(result.accountsSeen).toBe(0);
    expect(result.discoveryAttempts).toBe(1);
    expect(result.discoveryFailures).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      category: "external_transient",
      operation: "account_discovery",
      accountRef: null,
      error: {
        code: 2,
        subcode: 99,
        traceId: "trace-discovery",
      },
    });
    expect(result.errors[0]).not.toHaveProperty("userEmail");
    expect(result.errors[0]).not.toHaveProperty("accountId");
    expect(recorded.runs[0]).toMatchObject({
      status: "completed_with_errors",
      summary: {
        discoveryAttempts: 1,
        discoveryFailures: 1,
        hasDiscoveryFailure: 1,
        issuesExternalTransient: 1,
      },
    });
  });

  test("componentes degradados e paginação truncada não alteram a cobertura principal", async () => {
    const { ports, recorded } = makePorts({
      listEntities: async () => ({
        entities: activeListing(),
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 75,
        truncatedLevels: ["ad"],
      }),
      collectActivityEvents: async () => ({
        eventsUpserted: 25,
        eventsMatched: 3,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 25,
        paginationTruncated: true,
      }),
      collectDailyMetrics: async () => ({
        rowsUpserted: 40,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 6,
        stoppedForQuota: false,
        slicesDegraded: 3,
        strategyLoadFailures: 0,
        strategySaveFailures: 0,
        levelsAbandoned: ["adset"],
      }),
      collectCreativeSnapshots: async () => ({
        creativesFetched: 10,
        creativesPending: 4,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 2,
        stoppedForQuota: false,
        appRateLimitEvents: 0,
        failureMessage: "Meta recusou parte dos criativos",
      }),
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage[0]).toMatchObject({ status: "complete" });
    expect(result).toMatchObject({
      accountsCovered: 1,
      listingPaginationTruncated: 1,
      activityAccountsAttempted: 1,
      activityAccountsFailed: 0,
      activityPaginationTruncated: 1,
      insightsAccountsAttempted: 1,
      insightsAccountsFailed: 0,
      insightsLevelsAbandoned: 1,
      insightsAdsetLevelsAbandoned: 1,
      creativeAccountsAttempted: 1,
      creativeAccountsFailed: 1,
      issuesDegradedComponent: 4,
    });
    expect(recorded.runs[0].summary).toMatchObject({
      hasDegradedComponents: 1,
      hasPaginationTruncation: 1,
      listingPaginationTruncated: 1,
      activityPaginationTruncated: 1,
      insightsLevelsAbandoned: 1,
      creativeAccountsFailed: 1,
    });
  });

  test("callbacks e issues expõem somente referências pseudonimizadas", async () => {
    const started: Array<{ userRef: string; accountRef: string }> = [];
    const issues: Array<{
      userRef: string | null;
      accountRef: string | null;
      category: string;
    }> = [];
    const { ports } = makePorts({
      collectActivityEvents: async () => {
        throw new Error(
          `activities falhou para ${USER.email} e ${ACCOUNT.accountId}`,
        );
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
      onAccountStart: ({ userRef, accountRef }) =>
        started.push({ userRef, accountRef }),
      onIssue: ({ userRef, accountRef, category }) =>
        issues.push({ userRef, accountRef, category }),
    });

    expect(started).toHaveLength(1);
    expect(started[0].userRef).not.toContain(USER.id);
    expect(started[0].accountRef).not.toContain(ACCOUNT.accountId);
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe("degraded_component");
    expect(JSON.stringify(result.errors)).not.toContain(USER.email);
    expect(JSON.stringify(result.errors)).not.toContain(ACCOUNT.accountId);
  });

  test("erro ORM enorme é limitado antes de cobertura e resumo", async () => {
    const cause = Object.assign(new Error("bind limit"), { code: "08P01" });
    const huge = new Error(
      `Failed query: insert ${"x".repeat(2_500_000)} ${USER.email} ${ACCOUNT.accountId}`,
      { cause },
    );
    const { ports, recorded } = makePorts({
      persistAccountDelta: async () => {
        throw huge;
      },
    });

    const result = await runDailyTrackingCollection(ports, {
      triggeredBy: "cron",
    });

    expect(recorded.coverage[0].errorMessage!.length).toBeLessThanOrEqual(1_000);
    expect(recorded.coverage[0].errorMessage).not.toContain(USER.email);
    expect(recorded.coverage[0].errorMessage).not.toContain(ACCOUNT.accountId);
    expect(recorded.coverage[0].errorMessage).toContain("cause=08P01:bind limit");
    expect(result.errors[0].error).toMatchObject({
      cause: { code: "08P01" },
    });
    expect(JSON.stringify(recorded.runs[0]).length).toBeLessThan(10_000);
  });
});
