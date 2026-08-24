import { describe, expect, test } from "bun:test";

import {
  describeBackfillSlice,
  runMetaTrackingBackfill,
  type BackfillPorts,
  type BackfillResult,
} from "@/lib/meta-tracking/run-backfill";
import {
  backfillTargetRange,
  EMPTY_BACKFILL_PROGRESS,
  type BackfillAccountProgress,
  type DayRange,
} from "@/lib/meta-tracking/backfill-plan";
import { UNKNOWN_QUOTA_USAGE, type QuotaUsage } from "@/lib/meta-tracking/quota-usage";
import {
  adsetConfigV25,
  campaignConfigV25,
  FIXTURE_ACCOUNT_ID,
  FIXTURE_ADSET_ID,
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_MANAGED_PREFIX,
  FIXTURE_USER_ID,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";
import type { TrackingDelta } from "@/lib/meta-tracking/compute-tracking-delta";
import type { ListedEntity } from "@/lib/meta-tracking/daily-collection-plan";
import type { DailyMetricsResult } from "@/lib/meta-tracking/collect-daily-metrics";

/** 2026-08-09 05:00 BRT — a madrugada em que o backfill roda. */
const NOW = new Date("2026-08-09T08:00:00.000Z");
const TODAY = "2026-08-09";
const TARGET = backfillTargetRange(TODAY);

const USER = { id: FIXTURE_USER_ID, email: "cliente@exemplo.com.br" };

const ACCOUNT = {
  accountId: FIXTURE_ACCOUNT_ID,
  name: "Conta do cliente",
  currency: "BRL",
  timezoneName: "America/Sao_Paulo",
};

function listing(): ListedEntity[] {
  return [
    {
      entityLevel: "campaign",
      entityId: FIXTURE_CAMPAIGN_ID,
      name: `${FIXTURE_MANAGED_PREFIX}[VENDAS][FS][2026-06-18]`,
      campaignId: null,
      adsetId: null,
      status: "PAUSED",
      effectiveStatus: "PAUSED",
      updatedTime: new Date("2026-07-01T10:00:00.000Z"),
    },
    {
      entityLevel: "adset",
      entityId: FIXTURE_ADSET_ID,
      name: "Conjunto — Brasil 25-45",
      campaignId: FIXTURE_CAMPAIGN_ID,
      adsetId: null,
      status: "ACTIVE",
      effectiveStatus: "CAMPAIGN_PAUSED",
      updatedTime: new Date("2026-07-01T10:00:00.000Z"),
    },
    {
      entityLevel: "campaign",
      entityId: "120250000000000777",
      name: "Campanha removida",
      campaignId: null,
      adsetId: null,
      status: "DELETED",
      effectiveStatus: "DELETED",
      updatedTime: null,
    },
  ];
}

type Recorded = {
  slices: DayRange[];
  deltas: TrackingDelta[];
  progressSaved: BackfillAccountProgress[];
  countersSaved: { slicesCompleted: number; metricRowsUpserted: number }[];
  finished: { status: string; summary: Record<string, unknown> }[];
  runKinds: string[];
  claimed: { runId: string; accountId: string }[];
};

function makePorts(
  overrides: Partial<BackfillPorts> = {},
  options: {
    progress?: BackfillAccountProgress;
    clock?: { value: Date };
  } = {},
): { ports: BackfillPorts; recorded: Recorded } {
  const recorded: Recorded = {
    slices: [],
    deltas: [],
    progressSaved: [],
    countersSaved: [],
    finished: [],
    runKinds: [],
    claimed: [],
  };
  const clock = options.clock ?? { value: NOW };

  const ports: BackfillPorts = {
    now: () => clock.value,
    getManagedCampaignPrefix: async () => FIXTURE_MANAGED_PREFIX,
    listUsersWithMeta: async () => [USER],
    getCredentials: async () => ({
      ok: true,
      credentials: { accessToken: "token-de-teste" },
    }),
    listAdAccounts: async () => ({
      accounts: [ACCOUNT],
      usage: UNKNOWN_QUOTA_USAGE,
      apiCalls: 1,
    }),
    listEntities: async () => ({
      entities: listing(),
      usage: UNKNOWN_QUOTA_USAGE,
      apiCalls: 3,
    }),
    fetchConfigs: async ({ chunks }) => ({
      configs: chunks.flatMap((chunk) =>
        chunk.entityIds.map((entityId) => ({
          entityLevel: chunk.entityLevel,
          entityId,
          config:
            chunk.entityLevel === "campaign"
              ? campaignConfigV25({
                  id: entityId,
                  status: "PAUSED",
                  effective_status: "PAUSED",
                })
              : adsetConfigV25({ id: entityId }),
        })),
      ),
      usage: UNKNOWN_QUOTA_USAGE,
      apiCalls: chunks.length,
      stoppedForQuota: false,
    }),
    loadAccountState: async () => [],
    persistAccountDelta: async ({ delta }) => {
      recorded.deltas.push(delta);
      return {
        versionsCreated: delta.versions.length,
        eventsCreated: delta.events.length,
        versionsConfirmed: delta.confirmations.length,
        eventsLinked: delta.versionLinks.length,
      };
    },
    claimAccount: async ({ runId, accountId }) => {
      recorded.claimed.push({ runId, accountId });
      return true;
    },
    loadProgress: async () => options.progress ?? { ...EMPTY_BACKFILL_PROGRESS },
    saveProgress: async ({ progress, counters }) => {
      recorded.progressSaved.push({
        covered: progress.covered.map((range) => ({ ...range })),
        baselineCompletedAt: progress.baselineCompletedAt,
      });
      recorded.countersSaved.push({ ...counters });
    },
    collectMetrics: async ({ range }) => {
      recorded.slices.push(range);
      return metricsResult({ rowsUpserted: 10 });
    },
    createRun: async ({ kind }) => {
      recorded.runKinds.push(kind);
      return "run-de-teste";
    },
    finishRun: async ({ status, summary }) => {
      recorded.finished.push({ status, summary });
    },
    ...overrides,
  };

  return { ports, recorded };
}

function metricsResult(
  overrides: Partial<DailyMetricsResult> = {},
): DailyMetricsResult {
  return {
    rowsUpserted: 0,
    usage: UNKNOWN_QUOTA_USAGE,
    apiCalls: 12,
    stoppedForQuota: false,
    slicesDegraded: 0,
    strategyLoadFailures: 0,
    strategySaveFailures: 0,
    levelsAbandoned: [],
    ...overrides,
  };
}

const OPTIONS = { triggeredBy: "script" as const, sliceDays: 31 };

describe("runMetaTrackingBackfill", () => {
  test("conta nova ganha baseline de configuração e os 13 meses fatiados", async () => {
    const { ports, recorded } = makePorts();

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    expect(recorded.runKinds).toEqual(["backfill"]);
    // As fatias cobrem o alvo inteiro, da mais recente para a mais antiga.
    expect(recorded.slices[0].until).toBe(TARGET.until);
    expect(recorded.slices.at(-1)?.since).toBe(TARGET.since);
    expect(result.slicesCompleted).toBe(recorded.slices.length);
    expect(result.metricRowsUpserted).toBe(10 * recorded.slices.length);
    expect(result.accountsCompleted).toBe(1);
    expect(result.remainingDays).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test("o baseline registra pausadas e arquivadas SEM evento de criação retroativo", async () => {
    const { ports, recorded } = makePorts();

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    const baseline = recorded.deltas[0];
    // Versão para a campanha pausada e para o conjunto em cascata…
    expect(baseline.versions.map((version) => version.entityId).sort()).toEqual(
      [FIXTURE_ADSET_ID, FIXTURE_CAMPAIGN_ID].sort(),
    );
    // …e nenhum evento: a entidade existia antes do tracking, ninguém a criou hoje.
    expect(baseline.events).toEqual([]);
    expect(result.baselineVersionsCreated).toBe(2);
    // A removida fica de fora: o node batch falha inteiro com um id que não resolve.
    expect(
      baseline.versions.some((version) => version.entityId === "120250000000000777"),
    ).toBe(false);
  });

  test("a marca de Campanha Gerenciada é avaliada no baseline mesmo sem listagem", async () => {
    const { ports, recorded } = makePorts();

    await runMetaTrackingBackfill(ports, OPTIONS);

    expect(
      recorded.deltas[0].versions.every((version) => version.isManaged),
    ).toBe(true);
  });

  test("retomada não refaz período completo nem repete o baseline", async () => {
    const { ports, recorded } = makePorts(
      {},
      {
        progress: {
          covered: [{ since: "2025-11-01", until: TARGET.until }],
          baselineCompletedAt: "2026-08-01T08:00:00.000Z",
        },
      },
    );

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    expect(recorded.deltas).toEqual([]);
    expect(result.baselineVersionsCreated).toBe(0);
    expect(recorded.slices.every((slice) => slice.until < "2025-11-01")).toBe(true);
    expect(recorded.slices[0].until).toBe("2025-10-31");
  });

  test("--redo-baseline refaz a foto do estado atual mesmo com baseline antigo", async () => {
    const { ports, recorded } = makePorts(
      {},
      {
        progress: {
          covered: [{ since: "2024-01-01", until: "2026-08-09" }],
          baselineCompletedAt: "2026-08-01T08:00:00.000Z",
        },
      },
    );

    await runMetaTrackingBackfill(ports, { ...OPTIONS, redoBaseline: true });

    expect(recorded.deltas).toHaveLength(1);
    expect(recorded.progressSaved.at(-1)?.baselineCompletedAt).toBe(
      NOW.toISOString(),
    );
  });

  test("--account restringe o backfill a uma conta do cliente", async () => {
    const { ports, recorded } = makePorts({
      listAdAccounts: async () => ({
        accounts: [ACCOUNT, { ...ACCOUNT, accountId: "act_111222333444555" }],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
    });

    const result = await runMetaTrackingBackfill(ports, {
      ...OPTIONS,
      accountIds: ["act_111222333444555"],
      maxApiCallsPerAccount: 1,
    });

    expect(result.accountsSeen).toBe(1);
    expect(result.accountsProcessed).toBe(1);
    expect(recorded.deltas).toHaveLength(1);
  });

  test("conta já coberta não gasta chamada nenhuma", async () => {
    const { ports, recorded } = makePorts(
      {},
      {
        progress: {
          covered: [{ since: "2024-01-01", until: "2026-08-09" }],
          baselineCompletedAt: "2026-08-01T08:00:00.000Z",
        },
      },
    );

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    expect(recorded.slices).toEqual([]);
    expect(result.accountsCompleted).toBe(1);
    expect(result.remainingDays).toBe(0);
  });

  test("cada fatia concluída é gravada na hora: a interrupção seguinte não a refaz", async () => {
    const { ports, recorded } = makePorts();

    await runMetaTrackingBackfill(ports, OPTIONS);

    // Um checkpoint do baseline + um por fatia, cada um cumulativo.
    expect(recorded.progressSaved).toHaveLength(recorded.slices.length + 1);
    expect(recorded.progressSaved[0].baselineCompletedAt).toBe(NOW.toISOString());
    expect(recorded.progressSaved.at(-1)?.covered).toEqual([TARGET]);
    // E o contador por conta acompanha o checkpoint: é o que o run mostra.
    expect(recorded.countersSaved.at(-1)).toEqual({
      slicesCompleted: recorded.slices.length,
      metricRowsUpserted: 10 * recorded.slices.length,
    });
  });

  test("orçamento de chamadas da noite para a conta no meio, deixando o resto para amanhã", async () => {
    const { ports, recorded } = makePorts({
      collectMetrics: async ({ range }) => {
        recorded.slices.push(range);
        return metricsResult({ rowsUpserted: 5, apiCalls: 100 });
      },
    });

    const result = await runMetaTrackingBackfill(ports, {
      ...OPTIONS,
      maxApiCallsPerAccount: 250,
    });

    expect(recorded.slices).toHaveLength(3);
    expect(result.accountsPartial).toBe(1);
    expect(result.accountsCompleted).toBe(0);
    expect(result.remainingDays).toBeGreaterThan(0);
    // O que terminou está salvo: a próxima noite continua daqui.
    expect(recorded.progressSaved.at(-1)?.covered).toHaveLength(1);
  });

  test("cota da conta apertada interrompe o backfill antes de gerar erro na Meta", async () => {
    const { ports, recorded } = makePorts({
      collectMetrics: async ({ range }) => {
        recorded.slices.push(range);
        return metricsResult({
          rowsUpserted: 1,
          stoppedForQuota: true,
          usage: { utilizationPercent: 91, estimatedRegainMs: null } as QuotaUsage,
        });
      },
    });

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    expect(recorded.slices).toHaveLength(1);
    expect(result.accountsPartial).toBe(1);
  });

  test("fatia que falha reporta o erro, não entra no progresso e a seguinte continua", async () => {
    let call = 0;
    const { ports, recorded } = makePorts({
      collectMetrics: async ({ range }) => {
        call += 1;
        if (call === 1) throw new Error("Job assíncrono de insights não completou");
        recorded.slices.push(range);
        return metricsResult({ rowsUpserted: 7 });
      },
    });

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    expect(result.errors[0].message).toContain("Job assíncrono");
    // A fatia que falhou continua pendente; a próxima noite a refaz.
    expect(
      recorded.progressSaved.at(-1)?.covered.some((range) => range.until === TARGET.until),
    ).toBe(false);
    expect(recorded.slices.length).toBeGreaterThan(0);
    expect(result.accountsPartial).toBe(1);
  });

  test("falhas seguidas encerram a conta na noite em vez de insistir contra a Meta", async () => {
    const { ports } = makePorts({
      collectMetrics: async () => {
        throw new Error("Job assíncrono de insights não completou");
      },
    });

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    // A licença do app é throttled por taxa de erro: doze fatias, doze erros,
    // não. Duas bastam para saber que a conta não vai render hoje.
    expect(result.errors).toHaveLength(2);
    expect(result.accountsFailed).toBe(1);
  });

  test("baseline que falha deixa a conta parcial mesmo com a série inteira coberta", async () => {
    const { ports, recorded } = makePorts({
      listEntities: async () => {
        throw new Error("Meta recusou a listagem");
      },
    });

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    // A série foi capturada, mas o estado atual das entidades não: a conta não
    // está pronta, e nada foi marcado como concluído para a próxima noite tentar.
    expect(result.remainingDays).toBe(0);
    expect(result.accountsPartial).toBe(1);
    expect(result.accountsCompleted).toBe(0);
    expect(recorded.progressSaved.every((saved) => saved.baselineCompletedAt === null)).toBe(
      true,
    );
  });

  test("cliente sem token não é backfillado e aparece no run com o motivo", async () => {
    const { ports, recorded } = makePorts({
      getCredentials: async () => ({
        ok: false,
        needsReconnect: true,
        message: "Reconexão pendente com a Meta.",
      }),
    });

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    expect(recorded.slices).toEqual([]);
    expect(result.usersSkipped).toBe(1);
    expect(result.errors[0].message).toContain("Reconexão pendente");
    expect(recorded.finished[0].status).toBe("completed_with_errors");
  });

  test("o prazo da invocação para a varredura e o run diz que ainda falta base", async () => {
    const clock = { value: NOW };
    const { ports, recorded } = makePorts(
      {
        collectMetrics: async ({ range }) => {
          recorded.slices.push(range);
          clock.value = new Date(clock.value.getTime() + 60_000);
          return metricsResult({ rowsUpserted: 1 });
        },
      },
      { clock },
    );

    const result = await runMetaTrackingBackfill(ports, {
      ...OPTIONS,
      softDeadlineMs: 120_000,
    });

    expect(recorded.slices.length).toBeLessThan(12);
    expect(result.stoppedForBudget).toBe(true);
    expect(result.accountsPartial).toBe(1);
  });

  test("o run fecha com os contadores por conta e o progresso do alvo", async () => {
    const { ports, recorded } = makePorts({
      collectMetrics: async ({ range }) => {
        recorded.slices.push(range);
        return metricsResult({ rowsUpserted: 3, slicesDegraded: 1 });
      },
    });

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    expect(recorded.finished[0].summary).toMatchObject({
      accountsProcessed: 1,
      accountsCompleted: 1,
      slicesCompleted: result.slicesCompleted,
      metricRowsUpserted: 3 * result.slicesCompleted,
      metricSlicesDegraded: result.slicesCompleted,
      baselineVersionsCreated: 2,
      remainingDays: 0,
    });
    expect(recorded.finished[0].status).toBe("completed");
  });

  test("a coleta usa o dia da timezone da CONTA, não o do servidor", async () => {
    // 09/08 08:00 UTC ainda é 08/08 no Havaí: o alvo do backfill precisa andar
    // junto com o calendário em que a Meta reporta os dias daquela conta.
    const { ports, recorded } = makePorts({
      listAdAccounts: async () => ({
        accounts: [{ ...ACCOUNT, timezoneName: "Pacific/Honolulu" }],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
    });

    await runMetaTrackingBackfill(ports, OPTIONS);

    expect(recorded.slices[0].until).toBe(backfillTargetRange("2026-08-08").until);
    expect(recorded.slices[0].until).not.toBe(TARGET.until);
  });

  test("falha ao listar as contas do cliente não derruba o run inteiro", async () => {
    const { ports, recorded } = makePorts({
      listAdAccounts: async () => {
        throw new Error("Meta fora do ar");
      },
    });

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    expect(result.errors[0].message).toContain("Meta fora do ar");
    expect(recorded.finished[0].status).toBe("completed_with_errors");
  });

  test("insights só chegam com o período da fatia e o dia da conta", async () => {
    const seen: { range: DayRange; today: string }[] = [];
    const { ports } = makePorts({
      collectMetrics: async ({ range, today }) => {
        seen.push({ range, today });
        return metricsResult();
      },
    });

    await runMetaTrackingBackfill(ports, OPTIONS);

    expect(seen[0].today).toBe(TODAY);
    expect(seen[0].range).toEqual({ since: "2026-06-11", until: TARGET.until });
  });

  test("a conta é reivindicada antes de qualquer chamada à Meta", async () => {
    const { ports, recorded } = makePorts();

    await runMetaTrackingBackfill(ports, OPTIONS);

    expect(recorded.claimed).toEqual([
      { runId: "run-de-teste", accountId: FIXTURE_ACCOUNT_ID },
    ]);
  });

  test("conta já reivindicada por outro disparo é pulada inteira", async () => {
    const { ports, recorded } = makePorts({ claimAccount: async () => false });

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    // Nem baseline, nem fatia, nem checkpoint: quem tem o claim está cuidando.
    expect(recorded.deltas).toEqual([]);
    expect(recorded.slices).toEqual([]);
    expect(recorded.progressSaved).toEqual([]);
    expect(result.accountsSkippedByClaim).toBe(1);
    expect(result.accountsProcessed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(recorded.finished[0].status).toBe("completed");
    expect(recorded.finished[0].summary).toMatchObject({
      accountsSkippedByClaim: 1,
    });
  });

  test("conta pulada por claim não gasta a vaga do lote", async () => {
    const accounts = [
      { ...ACCOUNT, accountId: "act_111" },
      { ...ACCOUNT, accountId: "act_222" },
    ];
    const asked: string[] = [];
    const { ports } = makePorts({
      listAdAccounts: async () => ({
        accounts,
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
      claimAccount: async ({ accountId }) => {
        asked.push(accountId);
        return accountId !== "act_111";
      },
    });

    const result = await runMetaTrackingBackfill(ports, {
      ...OPTIONS,
      maxAccounts: 1,
    });

    expect(result.accountsSkippedByClaim).toBe(1);
    expect(result.accountsProcessed).toBe(1);
    expect(asked).toEqual(["act_111", "act_222"]);
  });

  test("reconexão de conta já coberta termina na primeira chamada", async () => {
    // O gatilho da conexão dispara igual em toda reconexão; quem faz isso sair
    // barato é o estado retomável, não uma verificação especial no gatilho.
    const { ports, recorded } = makePorts(
      {},
      {
        progress: {
          covered: [{ since: "2024-01-01", until: "2026-08-09" }],
          baselineCompletedAt: "2026-08-01T08:00:00.000Z",
        },
      },
    );

    const result = await runMetaTrackingBackfill(ports, OPTIONS);

    expect(recorded.slices).toEqual([]);
    expect(describeBackfillSlice(result)).toEqual({
      done: true,
      reason: "target_covered",
      remainingDays: 0,
    });
  });
});

describe("describeBackfillSlice", () => {
  function resultWith(overrides: Partial<BackfillResult>): BackfillResult {
    return {
      runId: "run-de-teste",
      usersConsidered: 1,
      usersSkipped: 0,
      accountsSeen: 1,
      accountsProcessed: 1,
      accountsSkippedByClaim: 0,
      accountsCompleted: 0,
      accountsPartial: 0,
      accountsFailed: 0,
      baselinesCreated: 0,
      baselineVersionsCreated: 0,
      slicesCompleted: 0,
      metricRowsUpserted: 0,
      metricSlicesDegraded: 0,
      remainingDays: 0,
      apiCallsUsed: 0,
      stoppedForBudget: false,
      errors: [],
      ...overrides,
    };
  }

  test("alvo inteiro coberto encerra a cadeia", () => {
    expect(
      describeBackfillSlice(
        resultWith({ accountsCompleted: 1, remainingDays: 0 }),
      ),
    ).toEqual({ done: true, reason: "target_covered", remainingDays: 0 });
  });

  test("período pendente pede a próxima chamada", () => {
    expect(
      describeBackfillSlice(
        resultWith({ accountsPartial: 1, remainingDays: 120 }),
      ),
    ).toEqual({ done: false, reason: "pending", remainingDays: 120 });
  });

  test("baseline pendente com série completa ainda pede outra chamada", () => {
    // `remainingDays` zerado não basta: a conta fica `partial` quando o baseline
    // de configuração falhou, e ele é a única foto de pausadas e arquivadas.
    expect(
      describeBackfillSlice(resultWith({ accountsPartial: 1, remainingDays: 0 })),
    ).toEqual({ done: false, reason: "pending", remainingDays: 0 });
  });

  test("lote interrompido pelo prazo continua na chamada seguinte", () => {
    expect(
      describeBackfillSlice(
        resultWith({ stoppedForBudget: true, accountsCompleted: 1 }),
      ),
    ).toEqual({ done: false, reason: "pending", remainingDays: 0 });
  });

  test("conta encerrada por falhas para a cadeia (a licença é throttled por erro)", () => {
    expect(
      describeBackfillSlice(
        resultWith({
          accountsFailed: 1,
          remainingDays: 300,
          errors: [{ userEmail: "x@y.z", accountId: "act_1", message: "boom" }],
        }),
      ),
    ).toEqual({ done: true, reason: "account_failed", remainingDays: 300 });
  });

  test("conta na mão de outro disparo encerra a cadeia sem girar em falso", () => {
    expect(
      describeBackfillSlice(
        resultWith({ accountsProcessed: 0, accountsSkippedByClaim: 1 }),
      ),
    ).toEqual({ done: true, reason: "claimed_elsewhere", remainingDays: 0 });
  });

  test("cliente sem conta ou sem token encerra a cadeia em vez de repetir", () => {
    expect(
      describeBackfillSlice(
        resultWith({
          accountsSeen: 0,
          accountsProcessed: 0,
          usersSkipped: 1,
          errors: [{ userEmail: "x@y.z", accountId: null, message: "sem token" }],
        }),
      ),
    ).toEqual({ done: true, reason: "nothing_to_do", remainingDays: 0 });
  });
});
