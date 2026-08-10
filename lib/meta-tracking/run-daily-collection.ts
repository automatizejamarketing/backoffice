/**
 * O coletor diário ponta a ponta (§5 e §12/F2 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Este arquivo é a ORQUESTRAÇÃO — a ordem das coisas e o que fazer quando cada
 * uma dá errado. Ele não sabe falar HTTP nem SQL: recebe portas
 * (`DailyCollectionPorts`) e as chama. Os executores de verdade vivem em
 * `lib/meta-tracking/graph-collector-gateway.ts` (Graph API) e
 * `lib/db/meta-tracking-collector-queries.ts` (Postgres), e são finos de
 * propósito: nenhum dos dois decide nada.
 *
 * A consequência é o que torna esta fundação testável: o comportamento inteiro
 * do coletor — idempotência, claim do dia, parada por cota, pulo por reconexão
 * pendente, drenagem em lotes — é exercitado com portas falsas, sem banco e sem
 * rede, que é a única forma honesta de testar um coletor que só pode rodar
 * contra contas reais de clientes.
 *
 * ## O pipeline por conta
 *
 * 1. **Claim** — conta com cobertura terminal hoje é pulada (é o `onlyStale` do
 *    cron, e é o que faz vários disparos na mesma madrugada drenarem a base sem
 *    refazer trabalho).
 * 2. **Listagem completa** — TODAS as entidades, com estado. É a única fonte de
 *    ciclo de vida: criação, pausa, arquivamento, remoção.
 * 3. **Fetch profundo** — só de quem está entregando, com pré-filtro de
 *    "atualizado desde" em conjuntos e anúncios (campanha nunca: a Meta
 *    documenta que mudança de orçamento não mexe no carimbo dela).
 * 4. **Delta** — a costura pura decide versões, eventos e confirmações.
 * 5. **Persistência** — numa transação por conta, para que "fechar a versão
 *    antiga e abrir a nova" seja uma coisa só.
 * 6. **Audit trail** — o poll do `/activities` com sobreposição de 48 h, que
 *    grava os eventos crus e enriquece com autor e horário exato as ações que o
 *    diff acabou de detectar. É a única etapa cuja falha NÃO conta contra a
 *    cobertura: o endpoint não é documentado por inteiro e o diff nunca depende
 *    dele — sem ele a ação existe do mesmo jeito, só que anônima.
 * 7. **Série diária** — os resultados dos últimos 28 dias nos três níveis, por
 *    upsert. Vem DEPOIS da persistência da configuração de propósito: se os
 *    insights falharem, a configuração do dia — que não existe em lugar nenhum
 *    para ser buscada depois — já está salva, e a série se recupera sozinha
 *    amanhã, quando a janela móvel re-coletar os mesmos dias.
 * 8. **Criativos** — o conteúdo dos criativos que os anúncios referenciam, uma
 *    foto única por criativo. Por último de propósito: é a única coleta que não
 *    perece (criativo é imutável na Meta), então é a primeira a ceder a vez
 *    quando a cota aperta, e a falha dela também não conta contra a cobertura.
 * 9. **Cobertura** — o que aconteceu com a conta naquele dia, sempre gravado:
 *    `complete`, `partial` (cota), `failed` ou `skipped_*` (token).
 *
 * ## Por que a cota interrompe em vez de esperar
 *
 * A licença Meta do app é throttled por TAXA DE ERRO. Um 429 custa mais do que
 * um dia de cobertura parcial, e a cobertura parcial é retomável: o disparo
 * seguinte do cron encontra a conta pendente e termina. Ver `quota-usage.ts`.
 */

import {
  computeTrackingDelta,
  INTERNAL_CHANGE_TOLERANCE_MS,
  type RecentInternalChange,
  type TrackingConfigObservation,
  type TrackingDelta,
} from "@/lib/meta-tracking/compute-tracking-delta";
import {
  hasCollectionBudgetLeft,
  isDayCoveredBy,
  planDeepFetch,
  coverageStatusForTokenFailure,
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
  dayKeyOf,
  isSupportedTimeZone,
  type DayKey,
} from "@/lib/meta-tracking/correlation";
import type { ActivityCollectionResult } from "@/lib/meta-tracking/collect-activity-events";
import type { DailyMetricsResult } from "@/lib/meta-tracking/collect-daily-metrics";
import type { CreativeSnapshotResult } from "@/lib/meta-tracking/collect-creative-snapshots";
import type {
  MetaTrackingCoverageStatus,
  MetaTrackingRunStatus,
  MetaTrackingRunTriggeredBy,
} from "@/lib/db/schema";

/** Timezone de negócio, usada quando a conta não informa a dela. */
export const DEFAULT_BUSINESS_TIME_ZONE = "America/Sao_Paulo";

/**
 * Contas por invocação. O cron dispara a cada 20 min na janela de madrugada, e
 * cada disparo drena um lote — o teto existe para caber com folga no limite de
 * duração da plataforma, não para limitar a base.
 */
export const DEFAULT_MAX_ACCOUNTS_PER_RUN = 40;

/**
 * Prazo por invocação, abaixo do `maxDuration = 300s` da rota de cron. A folga
 * é para a conta em andamento terminar e a cobertura dela ser gravada — uma
 * invocação morta no meio deixaria a conta sem registro nenhum.
 */
export const DEFAULT_SOFT_DEADLINE_MS = 240_000;

export type TrackedUser = { id: string; email: string };

/** Uma conta de anúncio atribuída ao usuário, como o coletor precisa dela. */
export type TrackedAdAccount = {
  /** Sempre no formato `act_<id>`. */
  accountId: string;
  name: string | null;
  currency: string | null;
  /** Timezone da conta — é ela que define o que a Meta chama de "dia". */
  timezoneName: string | null;
};

/** O que as portas de Graph API precisam para falar em nome do usuário. */
export type TrackingCredentials = {
  accessToken: string;
  tokenKind?: string | null;
  bisuAppScopedId?: string | null;
  clientBusinessId?: string | null;
  connectionName?: string | null;
};

export type TokenLookupResult =
  | { ok: true; credentials: TrackingCredentials }
  | { ok: false; needsReconnect: boolean; message: string };

/** Uma linha de `meta_tracking_account_coverage` pronta para upsert. */
export type AccountCoverageRecord = {
  runId: string;
  userId: string;
  accountId: string;
  /** `YYYY-MM-DD` na timezone da conta. */
  businessDate: DayKey;
  status: MetaTrackingCoverageStatus;
  errorMessage: string | null;
  entitiesSeen: number;
  apiCallsUsed: number;
  currency: string | null;
  timezoneName: string | null;
  completedAt: Date;
};

export type PersistDeltaResult = {
  versionsCreated: number;
  eventsCreated: number;
  versionsConfirmed: number;
  /** Ações internas que ganharam a versão nova como destino. */
  eventsLinked: number;
};

/**
 * As portas do coletor. Tudo que fala com o mundo passa por aqui — e é o que
 * um teste substitui para exercitar o pipeline inteiro sem banco e sem rede.
 */
export type DailyCollectionPorts = {
  now: () => Date;
  /** Prefixo de Campanha Gerenciada das regras operacionais do negócio. */
  getManagedCampaignPrefix: () => Promise<string>;
  listUsersWithMeta: (options: {
    userIds?: string[];
  }) => Promise<TrackedUser[]>;
  getCredentials: (userId: string) => Promise<TokenLookupResult>;
  /** Contas já vistas antes — é o que permite marcar cobertura sem token. */
  listKnownAccountIds: (userId: string) => Promise<string[]>;
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
    /** A busca parou no meio para não estourar a cota da conta. */
    stoppedForQuota: boolean;
  }>;
  loadAccountState: (args: {
    userId: string;
    accountId: string;
  }) => Promise<TrackedEntityState[]>;
  /**
   * Ações que a própria plataforma registrou no stream desde `since`. Sem
   * elas o coletor escreveria um segundo evento — anônimo — para a mudança que
   * o gestor ou o cliente acabou de fazer com autor e motivo.
   */
  loadRecentInternalChanges: (args: {
    accountId: string;
    since: Date;
  }) => Promise<RecentInternalChange[]>;
  getCoverageStatus: (args: {
    accountId: string;
    businessDate: DayKey;
  }) => Promise<MetaTrackingCoverageStatus | null>;
  recordCoverage: (record: AccountCoverageRecord) => Promise<void>;
  persistAccountDelta: (args: {
    runId: string;
    delta: TrackingDelta;
  }) => Promise<PersistDeltaResult>;
  /**
   * O audit trail da conta. Etapa separada e injetável: quem a implementa é
   * `collect-activity-events.ts`, e é ela quem sabe da sobreposição de 48 h, da
   * deduplicação e de qual evento cru explica qual ação.
   */
  collectActivityEvents: (args: {
    userId: string;
    accountId: string;
    credentials: TrackingCredentials;
    /** O instante da coleta desta conta — define a janela do poll. */
    now: Date;
  }) => Promise<ActivityCollectionResult>;
  /**
   * A série diária de resultados da conta. Etapa separada e injetável: quem a
   * implementa é `collect-daily-metrics.ts`, e é ela quem sabe da janela móvel,
   * do recuo por volume de linhas e do que já congelou.
   */
  collectDailyMetrics: (args: {
    userId: string;
    accountId: string;
    credentials: TrackingCredentials;
    /** Hoje na timezone da conta — o mesmo dia da cobertura. */
    today: DayKey;
    /** Cota já gasta pelas etapas anteriores desta conta. */
    usage: QuotaUsage;
  }) => Promise<DailyMetricsResult>;
  /**
   * O conteúdo dos criativos que os anúncios da conta referenciam. Etapa
   * separada e injetável: quem a implementa é `collect-creative-snapshots.ts`,
   * e é ela quem sabe descobrir os desconhecidos e respeitar o teto por
   * execução.
   */
  collectCreativeSnapshots: (args: {
    userId: string;
    accountId: string;
    credentials: TrackingCredentials;
    /** Cota já gasta pelas etapas anteriores desta conta. */
    usage: QuotaUsage;
  }) => Promise<CreativeSnapshotResult>;
  createRun: (args: {
    triggeredBy: MetaTrackingRunTriggeredBy;
  }) => Promise<string>;
  finishRun: (args: {
    runId: string;
    status: MetaTrackingRunStatus;
    summary: Record<string, number>;
    errorMessage: string | null;
  }) => Promise<void>;
};

export type DailyCollectionOptions = {
  triggeredBy: MetaTrackingRunTriggeredBy;
  /** Pular contas já resolvidas hoje. Ligado por padrão — é o claim do cron. */
  onlyStale?: boolean;
  maxAccounts?: number;
  softDeadlineMs?: number;
  /** Restringe a coleta a alguns usuários (script manual e diagnóstico). */
  userIds?: string[];
  onProgress?: (progress: {
    userEmail: string;
    accountId: string;
    status: MetaTrackingCoverageStatus;
    /** Linhas da série diária gravadas nesta conta. */
    metricRowsUpserted: number;
  }) => void;
};

export type DailyCollectionError = {
  userEmail: string;
  accountId: string | null;
  message: string;
};

export type DailyCollectionResult = {
  runId: string;
  usersConsidered: number;
  accountsSeen: number;
  accountsProcessed: number;
  accountsCovered: number;
  accountsPartial: number;
  accountsFailed: number;
  accountsSkipped: number;
  accountsAlreadyCovered: number;
  /** Token quebrado e nenhuma conta conhecida: não há linha de cobertura a gravar. */
  usersWithoutKnownAccounts: number;
  entitiesSeen: number;
  versionsCreated: number;
  eventsCreated: number;
  versionsConfirmed: number;
  eventsLinked: number;
  /** Eventos crus do audit trail gravados (novos e reconfirmados na sobreposição). */
  activityEventsUpserted: number;
  /** Ações que ganharam autor e horário exato vindos do audit trail. */
  activityEventsMatched: number;
  /** Linhas de `meta_tracking_daily_metrics` inseridas ou atualizadas. */
  metricRowsUpserted: number;
  /**
   * Quantas vezes um período de insights precisou ser partido por volume de
   * linhas. Diferente de zero = alguma conta está encostando no teto da Meta.
   */
  metricSlicesDegraded: number;
  /** Snapshots de criativo gravados (uma foto única por criativo). */
  creativesFetched: number;
  /**
   * Criativos que continuam sem snapshot. Diferente de zero é normal enquanto o
   * passivo de uma conta recém-ativada drena; alto e teimoso é sinal de que a
   * Meta está recusando os lotes.
   */
  creativesPending: number;
  stoppedForBudget: boolean;
  errors: DailyCollectionError[];
};

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * O dia da conta: timezone dela quando utilizável, negócio quando não.
 *
 * Exportada porque o backfill (`run-backfill.ts`) faz a MESMA pergunta — qual é
 * "hoje" para esta conta —, e a resposta precisa ser a mesma nos dois: é ela que
 * decide o que já congelou na série diária.
 */
export function businessDateFor(account: TrackedAdAccount, now: Date): DayKey {
  const timeZone =
    account.timezoneName && isSupportedTimeZone(account.timezoneName)
      ? account.timezoneName
      : DEFAULT_BUSINESS_TIME_ZONE;
  return dayKeyOf(now, timeZone);
}

export async function runDailyTrackingCollection(
  ports: DailyCollectionPorts,
  options: DailyCollectionOptions,
): Promise<DailyCollectionResult> {
  const onlyStale = options.onlyStale ?? true;
  const maxAccounts = Math.max(
    1,
    options.maxAccounts ?? DEFAULT_MAX_ACCOUNTS_PER_RUN,
  );
  const softDeadlineMs = Math.max(
    1_000,
    options.softDeadlineMs ?? DEFAULT_SOFT_DEADLINE_MS,
  );
  const startedAt = ports.now();

  const result: DailyCollectionResult = {
    runId: "",
    usersConsidered: 0,
    accountsSeen: 0,
    accountsProcessed: 0,
    accountsCovered: 0,
    accountsPartial: 0,
    accountsFailed: 0,
    accountsSkipped: 0,
    accountsAlreadyCovered: 0,
    usersWithoutKnownAccounts: 0,
    entitiesSeen: 0,
    versionsCreated: 0,
    eventsCreated: 0,
    versionsConfirmed: 0,
    eventsLinked: 0,
    activityEventsUpserted: 0,
    activityEventsMatched: 0,
    metricRowsUpserted: 0,
    metricSlicesDegraded: 0,
    creativesFetched: 0,
    creativesPending: 0,
    stoppedForBudget: false,
    errors: [],
  };

  const runId = await ports.createRun({ triggeredBy: options.triggeredBy });
  result.runId = runId;

  const summaryOf = (): Record<string, number> => ({
    usersConsidered: result.usersConsidered,
    accountsCovered: result.accountsCovered,
    accountsPartial: result.accountsPartial,
    accountsFailed: result.accountsFailed,
    accountsSkipped: result.accountsSkipped,
    accountsAlreadyCovered: result.accountsAlreadyCovered,
    entitiesSeen: result.entitiesSeen,
    versionsCreated: result.versionsCreated,
    eventsCreated: result.eventsCreated,
    versionsConfirmed: result.versionsConfirmed,
    eventsLinked: result.eventsLinked,
    activityEventsUpserted: result.activityEventsUpserted,
    activityEventsMatched: result.activityEventsMatched,
    metricRowsUpserted: result.metricRowsUpserted,
    metricSlicesDegraded: result.metricSlicesDegraded,
    creativesFetched: result.creativesFetched,
    creativesPending: result.creativesPending,
  });

  try {
    const managedCampaignNamePrefix = await ports.getManagedCampaignPrefix();
    const users = await ports.listUsersWithMeta({ userIds: options.userIds });

    for (const user of users) {
      if (result.stoppedForBudget) break;
      result.usersConsidered += 1;

      const token = await ports.getCredentials(user.id);
      if (!token.ok) {
        await skipUserWithoutToken({ ports, runId, user, token, result });
        continue;
      }

      let accounts: TrackedAdAccount[];
      try {
        const listed = await ports.listAdAccounts({
          userId: user.id,
          credentials: token.credentials,
        });
        accounts = listed.accounts;
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

      result.accountsSeen += accounts.length;

      for (const account of accounts) {
        const businessDate = businessDateFor(account, ports.now());

        if (onlyStale) {
          const covered = await ports.getCoverageStatus({
            accountId: account.accountId,
            businessDate,
          });
          if (isDayCoveredBy(covered)) {
            result.accountsAlreadyCovered += 1;
            continue;
          }
        }

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

        result.accountsProcessed += 1;
        await collectAccount({
          ports,
          runId,
          user,
          account,
          businessDate,
          credentials: token.credentials,
          managedCampaignNamePrefix,
          result,
          onProgress: options.onProgress,
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
    // Uma falha aqui é da infraestrutura da coleta (banco fora, regras do
    // negócio ilegíveis), não de uma conta: o run não pode ficar `running`
    // para sempre, senão o próximo disparo o encontra como travado.
    await ports.finishRun({
      runId,
      status: "failed",
      summary: summaryOf(),
      errorMessage: errorMessageOf(error, "Coleta diária falhou"),
    });
    throw error;
  }
}

/**
 * Token quebrado: a conta não some do radar. Cada conta já conhecida do usuário
 * recebe cobertura do dia com o motivo, porque é isso que a tela de operação
 * mostra em destaque — token quebrado é buraco irrecuperável na série, e quanto
 * mais tarde o cliente for acionado, maior o buraco.
 */
async function skipUserWithoutToken(args: {
  ports: DailyCollectionPorts;
  runId: string;
  user: TrackedUser;
  token: { ok: false; needsReconnect: boolean; message: string };
  result: DailyCollectionResult;
}): Promise<void> {
  const { ports, runId, user, token, result } = args;
  const status = coverageStatusForTokenFailure(token);
  const knownAccountIds = await ports.listKnownAccountIds(user.id);

  if (knownAccountIds.length === 0) {
    // Nunca coletado e sem token: não há conta a que atribuir a cobertura.
    // Fica no resumo do run para não virar silêncio.
    result.usersWithoutKnownAccounts += 1;
    result.errors.push({
      userEmail: user.email,
      accountId: null,
      message: token.message,
    });
    return;
  }

  const now = ports.now();
  for (const accountId of knownAccountIds) {
    result.accountsSkipped += 1;
    await ports.recordCoverage({
      runId,
      userId: user.id,
      accountId,
      businessDate: dayKeyOf(now, DEFAULT_BUSINESS_TIME_ZONE),
      status,
      errorMessage: token.message,
      entitiesSeen: 0,
      apiCallsUsed: 0,
      currency: null,
      timezoneName: null,
      completedAt: now,
    });
  }
}

async function collectAccount(args: {
  ports: DailyCollectionPorts;
  runId: string;
  user: TrackedUser;
  account: TrackedAdAccount;
  businessDate: DayKey;
  credentials: TrackingCredentials;
  managedCampaignNamePrefix: string;
  result: DailyCollectionResult;
  onProgress: DailyCollectionOptions["onProgress"];
}): Promise<void> {
  const {
    ports,
    runId,
    user,
    account,
    businessDate,
    credentials,
    managedCampaignNamePrefix,
    result,
  } = args;

  const observedAt = ports.now();
  let usage: QuotaUsage = UNKNOWN_QUOTA_USAGE;
  let apiCallsUsed = 0;
  let entitiesSeen = 0;
  let metricRowsUpserted = 0;
  let status: MetaTrackingCoverageStatus = "complete";
  let errorMessage: string | null = null;

  try {
    const listing = await ports.listEntities({
      accountId: account.accountId,
      credentials,
    });
    usage = mergeQuotaUsage(usage, listing.usage);
    apiCallsUsed += listing.apiCalls;
    entitiesSeen = listing.entities.length;

    const previous = await ports.loadAccountState({
      userId: user.id,
      accountId: account.accountId,
    });

    let configs: TrackingConfigObservation[] = [];
    if (shouldStopForQuota(usage)) {
      // A listagem sozinha já apertou a cota: o ciclo de vida do dia é
      // registrado assim mesmo, e a configuração fica para o próximo disparo.
      status = "partial";
    } else {
      const plan = planDeepFetch({ listing: listing.entities, previous });
      const fetched = await ports.fetchConfigs({
        accountId: account.accountId,
        credentials,
        chunks: plan.chunks,
        usage,
      });
      usage = mergeQuotaUsage(usage, fetched.usage);
      apiCallsUsed += fetched.apiCalls;
      configs = fetched.configs;
      if (fetched.stoppedForQuota) status = "partial";
    }

    // O que a plataforma já registrou com autor e motivo. Lido DEPOIS do fetch
    // (a janela conta a partir da observação) e antes do delta, que é quem sabe
    // o que fazer com isso.
    const internalChanges = await ports.loadRecentInternalChanges({
      accountId: account.accountId,
      since: new Date(observedAt.getTime() - INTERNAL_CHANGE_TOLERANCE_MS),
    });

    const delta = computeTrackingDelta({
      userId: user.id,
      accountId: account.accountId,
      observedAt,
      managedCampaignNamePrefix,
      listing: listing.entities,
      configs,
      previous,
      internalChanges,
    });

    const persisted = await ports.persistAccountDelta({ runId, delta });
    result.entitiesSeen += entitiesSeen;
    result.versionsCreated += persisted.versionsCreated;
    result.eventsCreated += persisted.eventsCreated;
    result.versionsConfirmed += persisted.versionsConfirmed;
    result.eventsLinked += persisted.eventsLinked;

    // O enriquecimento vem DEPOIS da persistência do delta — ele precisa das
    // ações já gravadas para ligar autor e horário a elas — e por FORA do que
    // decide a cobertura: o `/activities` é a única fonte de "quem mexeu", mas
    // a Meta não documenta a retenção dele nem o formato do detalhe. Falhar
    // aqui não custa ação nenhuma (o diff já registrou tudo), e a sobreposição
    // de 48 h do poll dá ao próximo disparo uma segunda chance de enriquecer.
    if (status === "complete") {
      try {
        const activities = await ports.collectActivityEvents({
          userId: user.id,
          accountId: account.accountId,
          credentials,
          now: observedAt,
        });
        usage = mergeQuotaUsage(usage, activities.usage);
        apiCallsUsed += activities.apiCalls;
        result.activityEventsUpserted += activities.eventsUpserted;
        result.activityEventsMatched += activities.eventsMatched;
      } catch (error) {
        result.errors.push({
          userEmail: user.email,
          accountId: account.accountId,
          message: `Audit trail da Meta indisponível; as ações do dia ficaram sem autor: ${errorMessageOf(error, "erro desconhecido")}`,
        });
      }
    }

    // Só quando a configuração fechou o dia: se a cota já apertou, gastar mais
    // chamadas com insights é justamente o que a postura de cota evita — e a
    // janela móvel de 28 dias devolve estes mesmos dias no próximo disparo.
    if (status === "complete") {
      const metrics = await ports.collectDailyMetrics({
        userId: user.id,
        accountId: account.accountId,
        credentials,
        today: businessDate,
        usage,
      });
      usage = mergeQuotaUsage(usage, metrics.usage);
      apiCallsUsed += metrics.apiCalls;
      metricRowsUpserted = metrics.rowsUpserted;
      result.metricSlicesDegraded += metrics.slicesDegraded;
      if (metrics.stoppedForQuota) status = "partial";

      for (const entityLevel of metrics.levelsAbandoned) {
        // Cobertura segue `complete`: o erro veio da Meta e insistir hoje só
        // aumentaria a taxa de erro do app. Fica visível no run, que é onde o
        // operador vê que aquele nível ficou sem série.
        result.errors.push({
          userEmail: user.email,
          accountId: account.accountId,
          message: `Insights de ${entityLevel} excederam o limite de linhas da Meta mesmo em um único dia; o nível ficou sem série em ${businessDate}.`,
        });
      }
    }

    // Criativos por ÚLTIMO, e por fora do que decide a cobertura: é a única
    // coisa que esta coleta busca e que não perece. Criativo é imutável na
    // Meta, então o que não couber hoje continua igual amanhã — enquanto a
    // configuração do dia não existe em lugar nenhum para ser buscada depois.
    // Daí ser o primeiro a ceder a vez quando a cota aperta, e a falha aqui não
    // custar o dia da conta.
    if (status === "complete") {
      try {
        const creatives = await ports.collectCreativeSnapshots({
          userId: user.id,
          accountId: account.accountId,
          credentials,
          usage,
        });
        usage = mergeQuotaUsage(usage, creatives.usage);
        apiCallsUsed += creatives.apiCalls;
        result.creativesFetched += creatives.creativesFetched;
        result.creativesPending += creatives.creativesPending;
        if (creatives.failureMessage) {
          result.errors.push({
            userEmail: user.email,
            accountId: account.accountId,
            message: `Conteúdo de criativos indisponível na Meta; ${creatives.creativesPending} criativo(s) seguem sem snapshot: ${creatives.failureMessage}`,
          });
        }
      } catch (error) {
        result.errors.push({
          userEmail: user.email,
          accountId: account.accountId,
          message: `Não foi possível capturar o conteúdo dos criativos: ${errorMessageOf(error, "erro desconhecido")}`,
        });
      }
    }
  } catch (error) {
    status = "failed";
    errorMessage = errorMessageOf(error, "Erro ao coletar a conta na Meta.");
    result.errors.push({
      userEmail: user.email,
      accountId: account.accountId,
      message: errorMessage,
    });
  }

  result.metricRowsUpserted += metricRowsUpserted;

  if (status === "complete") result.accountsCovered += 1;
  else if (status === "partial") result.accountsPartial += 1;
  else result.accountsFailed += 1;

  await ports.recordCoverage({
    runId,
    userId: user.id,
    accountId: account.accountId,
    businessDate,
    status,
    errorMessage,
    entitiesSeen,
    apiCallsUsed,
    currency: account.currency,
    timezoneName: account.timezoneName,
    completedAt: ports.now(),
  });

  args.onProgress?.({
    userEmail: user.email,
    accountId: account.accountId,
    status,
    metricRowsUpserted,
  });
}
