/**
 * O backfill de 13 meses (§6 e §12/F4 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Este arquivo é a ORQUESTRAÇÃO — a ordem das coisas e o que fazer quando cada
 * uma dá errado. Como o coletor diário, ele não sabe falar HTTP nem SQL: recebe
 * portas (`BackfillPorts`) e as chama. As decisões moram em `backfill-plan.ts`
 * (o que capturar, o que já foi capturado, como fatiar) e em
 * `async-insights-job.ts` (como esperar o relatório da Meta).
 *
 * ## Por que este job existe, e por que ele tem pressa
 *
 * A janela de insights da Meta desliza: 37 meses, deslocando um dia por dia. Não
 * há histórico de configuração nenhum — só o estado atual. Tudo que não for
 * capturado agora some para sempre, e não há segunda chance. Por isso o backfill
 * roda na ATIVAÇÃO de cada conta, e por isso ele é retomável: uma noite que
 * termina no meio não pode custar o trabalho já feito.
 *
 * ## O pipeline por conta
 *
 * 1. **Progresso** — o que noites anteriores já cobriram (§6: estado por conta
 *    para retomada). Vem do `summary` dos runs de backfill.
 * 2. **Baseline de configuração** — uma vez por conta: TODAS as entidades,
 *    inclusive pausadas e arquivadas, viram a primeira versão. Sem evento de
 *    criação: elas existiam antes de o tracking existir, ninguém as criou hoje.
 *    Daí em diante o coletor diário volta a ignorá-las até reativarem.
 * 3. **Fatias de resultados** — o alvo menos o coberto, fatiado, do mais recente
 *    para o mais antigo, cada fatia por job assíncrono de insights.
 * 4. **Checkpoint por fatia** — a fatia que terminou é gravada na hora. É o que
 *    faz timeout, cota e erro custarem uma fatia, não a noite inteira.
 *
 * ## O que este job deliberadamente NÃO faz
 *
 * - **Não grava cobertura conta×dia.** `meta_tracking_account_coverage` responde
 *   "esta conta foi coletada NESTE dia" e é o claim do coletor diário; escrever
 *   lá o passado que o backfill capturou diria que houve coleta de configuração
 *   em dias em que não houve, e apagaria a cobertura real de dias já coletados.
 *   O progresso do backfill mora no `summary` do run dele.
 * - **Não toca a janela móvel de 28 dias.** O alvo termina onde a coleta diária
 *   começa: linha mutável tem um dono só, e é quem a re-coleta todo dia.
 */

import {
  computeTrackingDelta,
  type TrackingConfigObservation,
  type TrackingDelta,
} from "@/lib/meta-tracking/compute-tracking-delta";
import {
  DEFAULT_MAX_API_CALLS_PER_ACCOUNT,
  hasApiCallBudgetLeft,
  planAccountBackfill,
  planBaselineFetch,
  withSliceCovered,
  type BackfillAccountProgress,
  type DayRange,
} from "@/lib/meta-tracking/backfill-plan";
import {
  hasCollectionBudgetLeft,
  type DeepFetchChunk,
  type ListedEntity,
  type TrackedEntityState,
} from "@/lib/meta-tracking/daily-collection-plan";
import {
  mergeQuotaUsage,
  shouldStopForQuota,
  UNKNOWN_QUOTA_USAGE,
  type QuotaUsage,
} from "@/lib/meta-tracking/quota-usage";
import {
  businessDateFor,
  type PersistDeltaResult,
  type TokenLookupResult,
  type TrackedAdAccount,
  type TrackedUser,
  type TrackingCredentials,
} from "@/lib/meta-tracking/run-daily-collection";
import type { DayKey } from "@/lib/meta-tracking/correlation";
import type { DailyMetricsResult } from "@/lib/meta-tracking/collect-daily-metrics";
import type {
  MetaTrackingRunKind,
  MetaTrackingRunStatus,
  MetaTrackingRunTriggeredBy,
} from "@/lib/db/schema";

/** Contas por invocação. O backfill é mais caro que a coleta diária. */
export const DEFAULT_MAX_ACCOUNTS_PER_BACKFILL = 10;

/**
 * Prazo por invocação, dimensionado para o script (que não tem limite de
 * plataforma).
 *
 * ATENÇÃO para quem for pendurar isto num cron: o prazo é verificado ENTRE
 * fatias, e uma fatia pode demorar até o prazo de espera do relatório
 * assíncrono (`DEFAULT_ASYNC_POLL_TIMEOUT_MS`, 180 s) depois de começar. Numa
 * rota com `maxDuration = 300`, passe algo em torno de 90 s — 90 + 180 ainda
 * cabe, 240 + 180 não.
 */
export const DEFAULT_BACKFILL_SOFT_DEADLINE_MS = 240_000;

/**
 * Fatias que podem falhar antes de a conta ser encerrada na noite.
 *
 * Duas, e não uma por fatia: a licença Meta do app é throttled por TAXA DE ERRO,
 * e uma conta com problema sistemático geraria um erro por fatia — doze erros
 * por noite, por conta. Duas falhas já dizem que a conta não vai render hoje; o
 * que ficou pendente continua pendente e volta amanhã.
 */
export const MAX_SLICE_FAILURES_PER_ACCOUNT = 2;

export type BackfillPorts = {
  now: () => Date;
  getManagedCampaignPrefix: () => Promise<string>;
  listUsersWithMeta: (options: { userIds?: string[] }) => Promise<TrackedUser[]>;
  getCredentials: (userId: string) => Promise<TokenLookupResult>;
  listAdAccounts: (args: {
    userId: string;
    credentials: TrackingCredentials;
  }) => Promise<{
    accounts: TrackedAdAccount[];
    usage: QuotaUsage;
    apiCalls: number;
  }>;
  listEntities: (args: {
    accountId: string;
    credentials: TrackingCredentials;
  }) => Promise<{
    entities: ListedEntity[];
    usage: QuotaUsage;
    apiCalls: number;
  }>;
  fetchConfigs: (args: {
    accountId: string;
    credentials: TrackingCredentials;
    chunks: DeepFetchChunk[];
    usage: QuotaUsage;
  }) => Promise<{
    configs: TrackingConfigObservation[];
    usage: QuotaUsage;
    apiCalls: number;
    stoppedForQuota: boolean;
  }>;
  loadAccountState: (args: {
    userId: string;
    accountId: string;
  }) => Promise<TrackedEntityState[]>;
  /**
   * Reserva a conta para ESTE run. `false` = outro disparo vivo já está nela e
   * esta invocação não deve tocá-la.
   *
   * Existe porque o backfill ganhou um segundo disparador (o workflow que nasce
   * na conexão da Meta, ticket 10) e o dreno manual continua existindo. Ver
   * `lib/meta-tracking/backfill-claim.ts` para a semântica e a expiração.
   */
  claimAccount: (args: {
    runId: string;
    accountId: string;
  }) => Promise<boolean>;
  persistAccountDelta: (args: {
    runId: string;
    delta: TrackingDelta;
  }) => Promise<PersistDeltaResult>;
  /** O que noites anteriores já cobriram nesta conta. */
  loadProgress: (accountId: string) => Promise<BackfillAccountProgress>;
  /**
   * Checkpoint: gravado assim que uma fatia (ou o baseline) termina. Leva
   * também o que ESTE run já fez na conta — é o contador por conta que a tela de
   * operação lê do run (§9 do plano).
   */
  saveProgress: (args: {
    runId: string;
    accountId: string;
    progress: BackfillAccountProgress;
    counters: BackfillAccountCounters;
  }) => Promise<void>;
  /**
   * Uma fatia de série diária. É o mesmo passo do coletor diário
   * (`collect-daily-metrics.ts`) com o período trocado e as portas apontando
   * para o job assíncrono de insights.
   */
  collectMetrics: (args: {
    userId: string;
    accountId: string;
    credentials: TrackingCredentials;
    /** Hoje na timezone da conta — é ele que decide o que já congelou. */
    today: DayKey;
    range: DayRange;
    usage: QuotaUsage;
  }) => Promise<DailyMetricsResult>;
  createRun: (args: {
    kind: MetaTrackingRunKind;
    triggeredBy: MetaTrackingRunTriggeredBy;
  }) => Promise<string>;
  finishRun: (args: {
    runId: string;
    status: MetaTrackingRunStatus;
    summary: Record<string, number>;
    errorMessage: string | null;
  }) => Promise<void>;
};

export type BackfillOptions = {
  triggeredBy: MetaTrackingRunTriggeredBy;
  /** Restringe a alguns clientes (o caso normal: ativação de uma conta). */
  userIds?: string[];
  /** Restringe a algumas contas de anúncio do cliente. */
  accountIds?: string[];
  months?: number;
  sliceDays?: number;
  maxAccounts?: number;
  /** Orçamento de chamadas por conta nesta invocação. */
  maxApiCallsPerAccount?: number;
  softDeadlineMs?: number;
  /** Refaz o baseline de configuração mesmo se já houver um. */
  redoBaseline?: boolean;
  onProgress?: (progress: {
    userEmail: string;
    accountId: string;
    status: BackfillAccountStatus;
    slicesCompleted: number;
    metricRowsUpserted: number;
    remainingDays: number;
  }) => void;
};

/** `completed` = alvo inteiro coberto; `partial` = ainda falta período. */
export type BackfillAccountStatus = "completed" | "partial" | "failed";

/** O que este run fez nesta conta — o contador por conta do critério 6. */
export type BackfillAccountCounters = {
  slicesCompleted: number;
  metricRowsUpserted: number;
};

export type BackfillError = {
  userEmail: string;
  accountId: string | null;
  message: string;
};

export type BackfillResult = {
  runId: string;
  usersConsidered: number;
  /** Clientes sem token: o backfill deles não pode nem começar. */
  usersSkipped: number;
  accountsSeen: number;
  accountsProcessed: number;
  /** Contas que outro disparo vivo já estava backfillando. */
  accountsSkippedByClaim: number;
  accountsCompleted: number;
  accountsPartial: number;
  accountsFailed: number;
  baselinesCreated: number;
  baselineVersionsCreated: number;
  slicesCompleted: number;
  metricRowsUpserted: number;
  metricSlicesDegraded: number;
  /** Dias do alvo ainda não capturados, somados sobre as contas processadas. */
  remainingDays: number;
  apiCallsUsed: number;
  stoppedForBudget: boolean;
  errors: BackfillError[];
};

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Por que a cadeia de chamadas parou (ou não). */
export type BackfillSliceReason =
  | "target_covered"
  | "pending"
  | "account_failed"
  | "claimed_elsewhere"
  | "nothing_to_do";

export type BackfillSliceOutcome = {
  /** `true` = não adianta chamar de novo agora. */
  done: boolean;
  reason: BackfillSliceReason;
  remainingDays: number;
};

/**
 * "Vale a pena chamar de novo?" — a leitura de um `BackfillResult` pelo olho de
 * quem encadeia invocações (o workflow do ticket 10, que roda uma fatia por
 * chamada até o backfill do cliente terminar).
 *
 * As duas paradas que não são "terminou" merecem explicação:
 *
 * - **`account_failed`**: a conta esgotou as falhas de fatia da noite. A licença
 *   Meta do app é throttled por TAXA DE ERRO — insistir agora só piora o
 *   problema que causou a falha. O que ficou pendente continua pendente e volta
 *   pelo dreno noturno.
 * - **`claimed_elsewhere`**: outro disparo vivo está com a conta. Chamar de novo
 *   giraria em falso até o claim expirar; quem tem o claim vai terminar.
 */
export function describeBackfillSlice(
  result: BackfillResult,
): BackfillSliceOutcome {
  const remainingDays = result.remainingDays;

  if (result.accountsFailed > 0) {
    return { done: true, reason: "account_failed", remainingDays };
  }
  // O lote acabou pelo prazo ou pelo teto de contas: sobrou base para a próxima
  // chamada, e `remainingDays` só fala das contas que ESTA invocação tocou.
  if (result.stoppedForBudget) {
    return { done: false, reason: "pending", remainingDays };
  }
  if (result.accountsProcessed === 0) {
    return {
      done: true,
      reason:
        result.accountsSkippedByClaim > 0 ? "claimed_elsewhere" : "nothing_to_do",
      remainingDays,
    };
  }
  if (remainingDays === 0 && result.accountsPartial === 0) {
    return { done: true, reason: "target_covered", remainingDays };
  }
  return { done: false, reason: "pending", remainingDays };
}

export async function runMetaTrackingBackfill(
  ports: BackfillPorts,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const maxAccounts = Math.max(
    1,
    options.maxAccounts ?? DEFAULT_MAX_ACCOUNTS_PER_BACKFILL,
  );
  const softDeadlineMs = Math.max(
    1_000,
    options.softDeadlineMs ?? DEFAULT_BACKFILL_SOFT_DEADLINE_MS,
  );
  const maxApiCalls = Math.max(
    1,
    options.maxApiCallsPerAccount ?? DEFAULT_MAX_API_CALLS_PER_ACCOUNT,
  );
  const startedAt = ports.now();
  const accountFilter =
    options.accountIds && options.accountIds.length > 0
      ? new Set(options.accountIds)
      : null;

  const result: BackfillResult = {
    runId: "",
    usersConsidered: 0,
    usersSkipped: 0,
    accountsSeen: 0,
    accountsProcessed: 0,
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
  };

  const runId = await ports.createRun({
    kind: "backfill",
    triggeredBy: options.triggeredBy,
  });
  result.runId = runId;

  const summaryOf = (): Record<string, number> => ({
    usersConsidered: result.usersConsidered,
    usersSkipped: result.usersSkipped,
    accountsProcessed: result.accountsProcessed,
    accountsSkippedByClaim: result.accountsSkippedByClaim,
    accountsCompleted: result.accountsCompleted,
    accountsPartial: result.accountsPartial,
    accountsFailed: result.accountsFailed,
    baselinesCreated: result.baselinesCreated,
    baselineVersionsCreated: result.baselineVersionsCreated,
    slicesCompleted: result.slicesCompleted,
    metricRowsUpserted: result.metricRowsUpserted,
    metricSlicesDegraded: result.metricSlicesDegraded,
    remainingDays: result.remainingDays,
    apiCallsUsed: result.apiCallsUsed,
  });

  try {
    const managedCampaignNamePrefix = await ports.getManagedCampaignPrefix();
    const users = await ports.listUsersWithMeta({ userIds: options.userIds });

    for (const user of users) {
      if (result.stoppedForBudget) break;
      result.usersConsidered += 1;

      const token = await ports.getCredentials(user.id);
      if (!token.ok) {
        // Sem token não há backfill possível — e é urgente: cada dia de espera
        // é um dia a menos na janela de 37 meses da Meta.
        result.usersSkipped += 1;
        result.errors.push({
          userEmail: user.email,
          accountId: null,
          message: token.message,
        });
        continue;
      }

      let accounts: TrackedAdAccount[];
      try {
        const listed = await ports.listAdAccounts({
          userId: user.id,
          credentials: token.credentials,
        });
        accounts = listed.accounts;
        result.apiCallsUsed += listed.apiCalls;
      } catch (error) {
        result.errors.push({
          userEmail: user.email,
          accountId: null,
          message: errorMessageOf(
            error,
            "Erro ao listar as contas de anúncio na Meta.",
          ),
        });
        continue;
      }

      for (const account of accounts) {
        if (accountFilter && !accountFilter.has(account.accountId)) continue;
        result.accountsSeen += 1;

        if (
          !hasCollectionBudgetLeft({
            startedAt,
            now: ports.now(),
            accountsProcessed: result.accountsProcessed,
            maxAccounts,
            softDeadlineMs,
          })
        ) {
          result.stoppedForBudget = true;
          break;
        }

        // O claim vem DEPOIS do orçamento e ANTES de qualquer chamada à Meta:
        // conta tomada por outro disparo não pode custar nem uma chamada, e
        // também não pode consumir a vaga do lote — a vaga é para quem ninguém
        // está atendendo.
        if (
          !(await ports.claimAccount({ runId, accountId: account.accountId }))
        ) {
          result.accountsSkippedByClaim += 1;
          continue;
        }

        result.accountsProcessed += 1;
        await backfillAccount({
          ports,
          options,
          runId,
          startedAt,
          softDeadlineMs,
          maxApiCalls,
          managedCampaignNamePrefix,
          user,
          account,
          credentials: token.credentials,
          result,
        });
      }
    }

    const status: MetaTrackingRunStatus =
      result.errors.length > 0 ? "completed_with_errors" : "completed";
    await ports.finishRun({
      runId,
      status,
      summary: summaryOf(),
      errorMessage: result.errors.length > 0 ? result.errors[0].message : null,
    });

    return result;
  } catch (error) {
    // Falha da infraestrutura do backfill (banco fora, regras ilegíveis): o run
    // não pode ficar `running` para sempre, senão o próximo disparo o encontra
    // como travado.
    await ports.finishRun({
      runId,
      status: "failed",
      summary: summaryOf(),
      errorMessage: errorMessageOf(error, "Backfill falhou"),
    });
    throw error;
  }
}

async function backfillAccount(args: {
  ports: BackfillPorts;
  options: BackfillOptions;
  runId: string;
  startedAt: Date;
  softDeadlineMs: number;
  maxApiCalls: number;
  managedCampaignNamePrefix: string;
  user: TrackedUser;
  account: TrackedAdAccount;
  credentials: TrackingCredentials;
  result: BackfillResult;
}): Promise<void> {
  const { ports, options, runId, user, account, credentials, result } = args;

  const today = businessDateFor(account, ports.now());
  let progress = await ports.loadProgress(account.accountId);
  let usage: QuotaUsage = UNKNOWN_QUOTA_USAGE;
  let apiCallsUsed = 0;
  let slicesCompleted = 0;
  let metricRowsUpserted = 0;
  let sliceFailures = 0;
  let baselineFailed = false;
  let status: BackfillAccountStatus = "completed";

  const checkpoint = async (next: BackfillAccountProgress) => {
    progress = next;
    await ports.saveProgress({
      runId,
      accountId: account.accountId,
      progress,
      counters: { slicesCompleted, metricRowsUpserted },
    });
  };

  if (progress.baselineCompletedAt === null || options.redoBaseline === true) {
    try {
      const baseline = await captureBaseline({
        ports,
        runId,
        managedCampaignNamePrefix: args.managedCampaignNamePrefix,
        user,
        account,
        credentials,
        usage,
      });
      usage = baseline.usage;
      apiCallsUsed += baseline.apiCalls;
      result.baselinesCreated += 1;
      result.baselineVersionsCreated += baseline.versionsCreated;
      await checkpoint({
        ...progress,
        baselineCompletedAt: ports.now().toISOString(),
      });
    } catch (error) {
      // A série ainda vale sem o baseline (é o passado irrecuperável), então a
      // falha do baseline não impede as fatias — só fica registrada, e a noite
      // seguinte tenta de novo, porque nada foi marcado como concluído.
      result.errors.push({
        userEmail: user.email,
        accountId: account.accountId,
        message: errorMessageOf(
          error,
          "Erro ao capturar o estado atual das entidades da conta.",
        ),
      });
      baselineFailed = true;
    }
  }

  const plan = planAccountBackfill({
    today,
    covered: progress.covered,
    months: options.months,
    sliceDays: options.sliceDays,
  });

  for (const slice of plan.slices) {
    if (shouldStopForQuota(usage)) {
      status = "partial";
      break;
    }
    if (!hasApiCallBudgetLeft({ apiCallsUsed, maxApiCalls: args.maxApiCalls })) {
      status = "partial";
      break;
    }
    if (
      ports.now().getTime() - args.startedAt.getTime() >=
      args.softDeadlineMs
    ) {
      result.stoppedForBudget = true;
      status = "partial";
      break;
    }

    try {
      const metrics = await ports.collectMetrics({
        userId: user.id,
        accountId: account.accountId,
        credentials,
        today,
        range: slice,
        usage,
      });
      usage = mergeQuotaUsage(usage, metrics.usage);
      apiCallsUsed += metrics.apiCalls;
      metricRowsUpserted += metrics.rowsUpserted;
      slicesCompleted += 1;
      result.metricSlicesDegraded += metrics.slicesDegraded;

      for (const entityLevel of metrics.levelsAbandoned) {
        result.errors.push({
          userEmail: user.email,
          accountId: account.accountId,
          message: `Insights de ${entityLevel} excederam o limite de linhas da Meta em ${slice.since}…${slice.until}; o nível ficou sem série neste período.`,
        });
      }

      // A fatia só entra no progresso depois de gravada. Uma fatia que falhou
      // continua pendente, e é isso que faz a retomada não pular buraco.
      await checkpoint(withSliceCovered(progress, slice));

      if (metrics.stoppedForQuota) {
        status = "partial";
        break;
      }
    } catch (error) {
      sliceFailures += 1;
      result.errors.push({
        userEmail: user.email,
        accountId: account.accountId,
        message: errorMessageOf(
          error,
          `Erro ao capturar ${slice.since}…${slice.until}.`,
        ),
      });
      if (sliceFailures >= MAX_SLICE_FAILURES_PER_ACCOUNT) {
        status = "failed";
        break;
      }
      status = "partial";
    }
  }

  // O que sobrou é recalculado sobre o progresso final: fatia que falhou e fatia
  // que não coube na noite contam igual — as duas continuam pendentes.
  const remaining = planAccountBackfill({
    today,
    covered: progress.covered,
    months: options.months,
    sliceDays: options.sliceDays,
  }).remainingDays;

  // Conta só está `completed` quando as duas metades do backfill fecharam: a
  // série do alvo inteiro E o baseline de configuração.
  if (status !== "failed") {
    status = remaining === 0 && !baselineFailed ? "completed" : "partial";
  }

  result.slicesCompleted += slicesCompleted;
  result.metricRowsUpserted += metricRowsUpserted;
  result.remainingDays += remaining;
  result.apiCallsUsed += apiCallsUsed;
  if (status === "completed") result.accountsCompleted += 1;
  else if (status === "partial") result.accountsPartial += 1;
  else result.accountsFailed += 1;

  options.onProgress?.({
    userEmail: user.email,
    accountId: account.accountId,
    status,
    slicesCompleted,
    metricRowsUpserted,
    remainingDays: remaining,
  });
}

/**
 * O estado atual de TODAS as entidades da conta vira a primeira versão.
 *
 * A costura do delta é alimentada com as configurações e SEM listagem: é a
 * listagem que produz eventos de ciclo de vida, e uma entidade que existe desde
 * antes do tracking não foi criada hoje. Sem isso o stream de ações nasceria com
 * uma onda de criações falsas, datadas do dia do backfill.
 */
async function captureBaseline(args: {
  ports: BackfillPorts;
  runId: string;
  managedCampaignNamePrefix: string;
  user: TrackedUser;
  account: TrackedAdAccount;
  credentials: TrackingCredentials;
  usage: QuotaUsage;
}): Promise<{ versionsCreated: number; usage: QuotaUsage; apiCalls: number }> {
  const { ports, user, account, credentials } = args;

  const listing = await ports.listEntities({
    accountId: account.accountId,
    credentials,
  });
  let usage = mergeQuotaUsage(args.usage, listing.usage);
  let apiCalls = listing.apiCalls;

  const fetched = await ports.fetchConfigs({
    accountId: account.accountId,
    credentials,
    chunks: planBaselineFetch({ listing: listing.entities }),
    usage,
  });
  usage = mergeQuotaUsage(usage, fetched.usage);
  apiCalls += fetched.apiCalls;

  const previous = await ports.loadAccountState({
    userId: user.id,
    accountId: account.accountId,
  });

  const delta = computeTrackingDelta({
    userId: user.id,
    accountId: account.accountId,
    observedAt: ports.now(),
    managedCampaignNamePrefix: args.managedCampaignNamePrefix,
    listing: [],
    configs: fetched.configs,
    previous,
  });

  const persisted = await ports.persistAccountDelta({ runId: args.runId, delta });
  return { versionsCreated: persisted.versionsCreated, usage, apiCalls };
}
