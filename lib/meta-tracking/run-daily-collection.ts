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
 *    `complete`, `partial` (cota/transiente), `failed` ou `skipped_*` (token).
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
  isDayCoveredBy,
  isAppWideRateLimitError,
  isRateLimitError,
  planDeepFetch,
  coverageStatusForCollectionError,
  coverageStatusForTokenFailure,
  type DeepFetchChunk,
  type ListedEntity,
  type TrackedEntityState,
} from "@/lib/meta-tracking/daily-collection-plan";
import {
  mergeQuotaUsage,
  shouldStopForAppQuota,
  shouldStopForQuota,
  UNKNOWN_QUOTA_USAGE,
  type QuotaUsage,
} from "@/lib/meta-tracking/quota-usage";
import {
  assertDeadlineBudget,
  createCollectionDeadline,
  DEFAULT_FINALIZATION_RESERVE_MS,
  hasDeadlineBudget,
  isCollectionDeadlineExceeded,
  MIN_ACCOUNT_START_BUDGET_MS,
  MIN_EXTERNAL_OPERATION_BUDGET_MS,
  MIN_PERSISTENCE_START_BUDGET_MS,
  type CollectionDeadline,
} from "@/lib/meta-tracking/collection-deadline";
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
  MetaTrackingEntityLevel,
  MetaTrackingRunStatus,
  MetaTrackingRunTriggeredBy,
} from "@/lib/db/schema";
import {
  enterMetaMutationLog,
  getMetaLogContext,
  updateMetaMutationContext,
} from "@/lib/observability/meta-log-context";
import {
  classifyTrackingIssue,
  pseudonymizeMetaIdentifier,
  safeErrorMessage,
  safeErrorSummary,
  sanitizeMetaLogText,
  type SafeErrorSummary,
  type TrackingIssueCategory,
} from "@/lib/observability/meta-log-safety";
import {
  GraphApiError,
  MetaTokenInvalidError,
  isMetaTokenInvalid,
} from "@/lib/meta-business/error";

/** Timezone de negócio, usada quando a conta não informa a dela. */
export const DEFAULT_BUSINESS_TIME_ZONE = "America/Sao_Paulo";

/**
 * Contas por invocação. O cron dispara a cada 15 min na janela de madrugada, e
 * cada disparo drena um lote — o teto existe para caber com folga no limite de
 * duração da plataforma, não para limitar a base. Com 32 disparos por
 * madrugada, o teto agregado é de 1.280 contas/dia.
 */
export const DEFAULT_MAX_ACCOUNTS_PER_RUN = 40;

/**
 * Prazo suave TOTAL por invocação, abaixo do `maxDuration = 800s` da rota.
 * O trabalho normal para antes dele: 30 s são reservados para cobertura e
 * `finishRun`, e os 200 s restantes até a Vercel são a barreira final para uma
 * persistência já iniciada que não aceite cancelamento.
 */
export const DEFAULT_SOFT_DEADLINE_MS = 600_000;

const BUDGET_STOP_MESSAGE =
  "Coleta interrompida por orçamento para preservar a reserva de finalização do run.";

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
  connectionId?: string;
  accessToken: string;
  tokenKind?: string | null;
  bisuAppScopedId?: string | null;
  clientBusinessId?: string | null;
  connectionName?: string | null;
};

export type TokenLookupResult =
  | { ok: true; credentials: TrackingCredentials }
  | {
      ok: false;
      needsReconnect: boolean;
      message: string;
      classification?: "customer_action_required" | "technical_failure";
    };

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
  getManagedCampaignPrefix: (deadline?: CollectionDeadline) => Promise<string>;
  listUsersWithMeta: (options: {
    userIds?: string[];
    deadline?: CollectionDeadline;
  }) => Promise<TrackedUser[]>;
  getCredentials: (
    userId: string,
    deadline?: CollectionDeadline,
  ) => Promise<TokenLookupResult>;
  /** Persiste Graph 190/102 sem regravar uma conexão já marcada. */
  markConnectionNeedsReconnect: (args: {
    userId: string;
    connectionId?: string;
    code: number;
    subcode?: number;
  }) => Promise<void>;
  /** Contas já vistas antes — é o que permite marcar cobertura sem token. */
  listKnownAccountIds: (
    userId: string,
    deadline?: CollectionDeadline,
  ) => Promise<string[]>;
  /**
   * Contas já vistas com a timezone da última cobertura — o bastante para o
   * pré-cheque "este usuário já está 100% coberto hoje?" responder sem gastar
   * nenhuma chamada de descoberta na Meta.
   */
  listKnownAccountsForPrecheck: (
    userId: string,
    deadline?: CollectionDeadline,
  ) => Promise<Array<{ accountId: string; timezoneName: string | null }>>;
  listAdAccounts: (args: {
    userId: string;
    credentials: TrackingCredentials;
    deadline?: CollectionDeadline;
  }) => Promise<{
    accounts: TrackedAdAccount[];
    usage: QuotaUsage;
    apiCalls: number;
  }>;
  listEntities: (args: {
    accountId: string;
    credentials: TrackingCredentials;
    deadline?: CollectionDeadline;
  }) => Promise<{
    entities: ListedEntity[];
    usage: QuotaUsage;
    apiCalls: number;
    /** Níveis que ainda tinham página seguinte ao atingir o teto do gateway. */
    truncatedLevels?: MetaTrackingEntityLevel[];
  }>;
  fetchConfigs: (args: {
    accountId: string;
    credentials: TrackingCredentials;
    chunks: DeepFetchChunk[];
    usage: QuotaUsage;
    deadline?: CollectionDeadline;
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
    deadline?: CollectionDeadline;
  }) => Promise<TrackedEntityState[]>;
  /**
   * Ações que a própria plataforma registrou no stream desde `since`. Sem
   * elas o coletor escreveria um segundo evento — anônimo — para a mudança que
   * o gestor ou o cliente acabou de fazer com autor e motivo.
   */
  loadRecentInternalChanges: (args: {
    accountId: string;
    since: Date;
    deadline?: CollectionDeadline;
  }) => Promise<RecentInternalChange[]>;
  getCoverageStatus: (args: {
    accountId: string;
    businessDate: DayKey;
    deadline?: CollectionDeadline;
  }) => Promise<MetaTrackingCoverageStatus | null>;
  recordCoverage: (record: AccountCoverageRecord) => Promise<void>;
  persistAccountDelta: (args: {
    runId: string;
    delta: TrackingDelta;
    deadline?: CollectionDeadline;
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
    deadline?: CollectionDeadline;
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
    deadline?: CollectionDeadline;
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
    deadline?: CollectionDeadline;
  }) => Promise<CreativeSnapshotResult>;
  createRun: (args: {
    triggeredBy: MetaTrackingRunTriggeredBy;
    deadline?: CollectionDeadline;
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
  /** Janela dentro do prazo suave reservada a coverage + `finishRun`. */
  finalizationReserveMs?: number;
  /** Restringe a coleta a alguns usuários (script manual e diagnóstico). */
  userIds?: string[];
  /**
   * Disparado ANTES de coletar cada conta. Existe para o chamador deixar um
   * rastro de "conta em voo" no log: quando a plataforma mata a invocação no
   * meio (limite de duração), o último início sem o término correspondente
   * identifica a conta que morreu no meio — sem isso a invocação morta não
   * deixa vestígio nenhum.
   */
  onAccountStart?: (info: {
    runId: string;
    userRef: string;
    accountRef: string;
  }) => void;
  onProgress?: (progress: {
    runId: string;
    userRef: string;
    accountRef: string;
    status: MetaTrackingCoverageStatus;
    /** Linhas da série diária gravadas nesta conta. */
    metricRowsUpserted: number;
    /** Motivo quando a conta não fechou limpa; null quando fechou. */
    errorMessage: string | null;
    /** Erro limitado da falha fatal, com stack/cause e códigos úteis. */
    error?: SafeErrorSummary;
  }) => void;
  /** Issues estruturadas; o cron emite as técnicas e agrega ação do cliente. */
  onIssue?: (issue: DailyCollectionError) => void;
};

export type DailyCollectionOperation =
  | "credential_lookup"
  | "account_discovery"
  | "entity_listing"
  | "account_collection"
  | "activities"
  | "insights"
  | "creative_content"
  | "run";

export type DailyCollectionEntity =
  | "user"
  | "ad_account"
  | MetaTrackingEntityLevel
  | "creative"
  | "run";

export type DailyCollectionError = {
  runId: string;
  category: TrackingIssueCategory;
  operation: DailyCollectionOperation;
  entity: DailyCollectionEntity;
  userRef: string | null;
  accountRef: string | null;
  message: string;
  error?: SafeErrorSummary;
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
  /** Subconjunto de skips que exige reconexão do cliente. */
  accountsSkippedReconnect: number;
  accountsAlreadyCovered: number;
  /** Usuários únicos cujo próximo passo é reconectar. */
  customerActionsRequired: number;
  /** Token quebrado e nenhuma conta conhecida: não há linha de cobertura a gravar. */
  usersWithoutKnownAccounts: number;
  /** Chamadas Graph devolvidas pelas etapas concluídas desta execução. */
  graphApiCalls: number;
  discoveryAttempts: number;
  discoveryFailures: number;
  /** Quantidade de níveis de listagem que atingiram 25 páginas. */
  listingPaginationTruncated: number;
  activityAccountsAttempted: number;
  activityAccountsFailed: number;
  activityPaginationTruncated: number;
  insightsAccountsAttempted: number;
  insightsAccountsFailed: number;
  insightsLevelsAbandoned: number;
  insightsCampaignLevelsAbandoned: number;
  insightsAdsetLevelsAbandoned: number;
  insightsAdLevelsAbandoned: number;
  creativeAccountsAttempted: number;
  creativeAccountsFailed: number;
  issuesCustomerActionRequired: number;
  issuesExternalTransient: number;
  issuesDegradedComponent: number;
  issuesInternalFailure: number;
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
  /** Loads fail-soft da memória adaptativa de Insights. */
  metricStrategyLoadFailures: number;
  /** Saves fail-soft da memória adaptativa de Insights. */
  metricStrategySaveFailures: number;
  /** Snapshots de criativo gravados (uma foto única por criativo). */
  creativesFetched: number;
  /**
   * Criativos que continuam sem snapshot. Diferente de zero é normal enquanto o
   * passivo de uma conta recém-ativada drena; alto e teimoso é sinal de que a
   * Meta está recusando os lotes.
   */
  creativesPending: number;
  /** Throttles reativos cujo código identifica cota do app inteiro. */
  appRateLimitEvents: number;
  /** Maior percentual global anunciado em headers nesta run. */
  maxAppQuotaUtilizationPercent: number | null;
  /** Breaker curto: nenhuma outra conta começa nesta invocação. */
  stoppedForAppQuota: boolean;
  stoppedForBudget: boolean;
  errors: DailyCollectionError[];
};

function errorMessageOf(error: unknown, fallback: string): string {
  return safeErrorMessage(error, fallback);
}

function userRefOf(userId: string): string {
  return pseudonymizeMetaIdentifier("user", userId);
}

function accountRefOf(accountId: string): string {
  return pseudonymizeMetaIdentifier("account", accountId);
}

const RECONNECT_REQUIRED_MESSAGE =
  "A conexão com a Meta foi invalidada e precisa ser refeita.";

function tokenInvalidDetailsOf(
  error: unknown,
): { code: number; subcode?: number } | null {
  if (!isMetaTokenInvalid(error)) return null;
  if (error instanceof MetaTokenInvalidError) {
    return {
      code: error.code,
      ...(error.subcode !== undefined ? { subcode: error.subcode } : {}),
    };
  }
  if (error instanceof GraphApiError) {
    const code = error.errorReturn.data?.code;
    if (typeof code === "number") {
      const subcode = error.errorReturn.data?.errorSubcode;
      return {
        code,
        ...(typeof subcode === "number" ? { subcode } : {}),
      };
    }
  }
  return null;
}

function noteCustomerActionRequired(
  result: DailyCollectionResult,
  userIds: Set<string>,
  userId: string,
): void {
  userIds.add(userId);
  result.customerActionsRequired = userIds.size;
}

function recordIssue(args: {
  result: DailyCollectionResult;
  onIssue: DailyCollectionOptions["onIssue"];
  category?: TrackingIssueCategory;
  fallbackCategory?: TrackingIssueCategory;
  operation: DailyCollectionOperation;
  entity: DailyCollectionEntity;
  userId?: string | null;
  accountId?: string | null;
  message: string;
  error?: unknown;
  errorSummary?: SafeErrorSummary;
}): DailyCollectionError {
  const category =
    args.category ??
    classifyTrackingIssue(args.error, args.fallbackCategory);
  const issue: DailyCollectionError = {
    runId: args.result.runId,
    category,
    operation: args.operation,
    entity: args.entity,
    userRef: args.userId ? userRefOf(args.userId) : null,
    accountRef: args.accountId ? accountRefOf(args.accountId) : null,
    message: sanitizeMetaLogText(args.message, 1_000),
    ...(args.errorSummary
      ? { error: args.errorSummary }
      : args.error !== undefined
        ? { error: safeErrorSummary(args.error, args.message) }
        : {}),
  };

  if (category === "customer_action_required") {
    args.result.issuesCustomerActionRequired += 1;
    // Ação conhecida do cliente fica nos counters/onIssue, não na coleção de
    // falhas técnicas nem no `errorMessage` da run.
    args.onIssue?.(issue);
    return issue;
  } else if (category === "external_transient") {
    args.result.issuesExternalTransient += 1;
  } else if (category === "degraded_component") {
    args.result.issuesDegradedComponent += 1;
  } else {
    args.result.issuesInternalFailure += 1;
  }
  args.result.errors.push(issue);
  args.onIssue?.(issue);
  return issue;
}

function observeAppQuota(
  result: DailyCollectionResult,
  usage: QuotaUsage,
): void {
  const utilization = usage.appUtilizationPercent;
  if (utilization !== undefined && utilization !== null) {
    result.maxAppQuotaUtilizationPercent =
      result.maxAppQuotaUtilizationPercent === null
        ? utilization
        : Math.max(result.maxAppQuotaUtilizationPercent, utilization);
  }
  if (shouldStopForAppQuota(usage)) result.stoppedForAppQuota = true;
}

function recordAppRateLimitError(
  result: DailyCollectionResult,
  error: unknown,
): boolean {
  if (!isAppWideRateLimitError(error)) return false;
  result.appRateLimitEvents += 1;
  result.stoppedForAppQuota = true;
  return true;
}

/**
 * O dia da conta: timezone dela quando utilizável, negócio quando não.
 *
 * Exportada porque o backfill (`run-backfill.ts`) faz a MESMA pergunta — qual é
 * "hoje" para esta conta —, e a resposta precisa ser a mesma nos dois: é ela que
 * decide o que já congelou na série diária.
 */
export function businessDateFor(
  account: Pick<TrackedAdAccount, "timezoneName">,
  now: Date,
): DayKey {
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
  const deadline = createCollectionDeadline({
    startedAt,
    timeoutMs: softDeadlineMs,
    finalizationReserveMs:
      options.finalizationReserveMs ?? DEFAULT_FINALIZATION_RESERVE_MS,
    now: ports.now,
  });

  const result: DailyCollectionResult = {
    runId: "",
    usersConsidered: 0,
    accountsSeen: 0,
    accountsProcessed: 0,
    accountsCovered: 0,
    accountsPartial: 0,
    accountsFailed: 0,
    accountsSkipped: 0,
    accountsSkippedReconnect: 0,
    accountsAlreadyCovered: 0,
    customerActionsRequired: 0,
    usersWithoutKnownAccounts: 0,
    graphApiCalls: 0,
    discoveryAttempts: 0,
    discoveryFailures: 0,
    listingPaginationTruncated: 0,
    activityAccountsAttempted: 0,
    activityAccountsFailed: 0,
    activityPaginationTruncated: 0,
    insightsAccountsAttempted: 0,
    insightsAccountsFailed: 0,
    insightsLevelsAbandoned: 0,
    insightsCampaignLevelsAbandoned: 0,
    insightsAdsetLevelsAbandoned: 0,
    insightsAdLevelsAbandoned: 0,
    creativeAccountsAttempted: 0,
    creativeAccountsFailed: 0,
    issuesCustomerActionRequired: 0,
    issuesExternalTransient: 0,
    issuesDegradedComponent: 0,
    issuesInternalFailure: 0,
    entitiesSeen: 0,
    versionsCreated: 0,
    eventsCreated: 0,
    versionsConfirmed: 0,
    eventsLinked: 0,
    activityEventsUpserted: 0,
    activityEventsMatched: 0,
    metricRowsUpserted: 0,
    metricSlicesDegraded: 0,
    metricStrategyLoadFailures: 0,
    metricStrategySaveFailures: 0,
    creativesFetched: 0,
    creativesPending: 0,
    appRateLimitEvents: 0,
    maxAppQuotaUtilizationPercent: null,
    stoppedForAppQuota: false,
    stoppedForBudget: false,
    errors: [],
  };
  const customerActionUserIds = new Set<string>();

  const summaryOf = (): Record<string, number> => {
    const summary: Record<string, number> = {
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
      graphApiCalls: result.graphApiCalls,
      discoveryAttempts: result.discoveryAttempts,
      discoveryFailures: result.discoveryFailures,
      hasDiscoveryFailure: result.discoveryFailures > 0 ? 1 : 0,
      listingPaginationTruncated: result.listingPaginationTruncated,
      activityAccountsAttempted: result.activityAccountsAttempted,
      activityAccountsFailed: result.activityAccountsFailed,
      activityPaginationTruncated: result.activityPaginationTruncated,
      insightsAccountsAttempted: result.insightsAccountsAttempted,
      insightsAccountsFailed: result.insightsAccountsFailed,
      insightsLevelsAbandoned: result.insightsLevelsAbandoned,
      insightsCampaignLevelsAbandoned:
        result.insightsCampaignLevelsAbandoned,
      insightsAdsetLevelsAbandoned: result.insightsAdsetLevelsAbandoned,
      insightsAdLevelsAbandoned: result.insightsAdLevelsAbandoned,
      creativeAccountsAttempted: result.creativeAccountsAttempted,
      creativeAccountsFailed: result.creativeAccountsFailed,
      issuesCustomerActionRequired: result.issuesCustomerActionRequired,
      issuesExternalTransient: result.issuesExternalTransient,
      issuesDegradedComponent: result.issuesDegradedComponent,
      issuesInternalFailure: result.issuesInternalFailure,
      hasDegradedComponents: result.issuesDegradedComponent > 0 ? 1 : 0,
      hasPaginationTruncation:
        result.listingPaginationTruncated > 0 ||
        result.activityPaginationTruncated > 0
          ? 1
          : 0,
      entitiesSeen: result.entitiesSeen,
      versionsCreated: result.versionsCreated,
      eventsCreated: result.eventsCreated,
      versionsConfirmed: result.versionsConfirmed,
      eventsLinked: result.eventsLinked,
      activityEventsUpserted: result.activityEventsUpserted,
      activityEventsMatched: result.activityEventsMatched,
      metricRowsUpserted: result.metricRowsUpserted,
      metricSlicesDegraded: result.metricSlicesDegraded,
      metricStrategyLoadFailures: result.metricStrategyLoadFailures,
      metricStrategySaveFailures: result.metricStrategySaveFailures,
      creativesFetched: result.creativesFetched,
      creativesPending: result.creativesPending,
      appRateLimitEvents: result.appRateLimitEvents,
      appQuotaStops: result.stoppedForAppQuota ? 1 : 0,
      stoppedForBudget: result.stoppedForBudget ? 1 : 0,
    };
    if (result.maxAppQuotaUtilizationPercent !== null) {
      summary.maxAppQuotaUtilizationPercent =
        result.maxAppQuotaUtilizationPercent;
    }
    return summary;
  };

  let runId = "";
  let runCreated = false;
  const finishCompletedRun = async (): Promise<void> => {
    const hasTechnicalIssue =
      result.accountsFailed > 0 ||
      result.issuesExternalTransient > 0 ||
      result.issuesDegradedComponent > 0 ||
      result.issuesInternalFailure > 0;
    const status: MetaTrackingRunStatus =
      hasTechnicalIssue ? "completed_with_errors" : "completed";
    const firstTechnicalIssue = result.errors.find(
      (issue) => issue.category !== "customer_action_required",
    );
    await ports.finishRun({
      runId,
      status,
      summary: summaryOf(),
      errorMessage: firstTechnicalIssue?.message ?? null,
    });
  };

  try {
    runId = await ports.createRun({
      triggeredBy: options.triggeredBy,
      deadline,
    });
    runCreated = true;
    result.runId = runId;
    if (getMetaLogContext()) {
      updateMetaMutationContext({ runId });
    } else {
      enterMetaMutationLog({
        app: "backoffice",
        route: "meta-tracking/daily",
      });
      updateMetaMutationContext({ runId });
    }

    assertDeadlineBudget(
      deadline,
      "carregar regras de negócio",
      MIN_PERSISTENCE_START_BUDGET_MS,
    );
    const managedCampaignNamePrefix =
      await ports.getManagedCampaignPrefix(deadline);
    assertDeadlineBudget(
      deadline,
      "listar usuários com Meta",
      MIN_PERSISTENCE_START_BUDGET_MS,
    );
    const users = await ports.listUsersWithMeta({
      userIds: options.userIds,
      deadline,
    });

    for (const user of users) {
      if (result.stoppedForBudget || result.stoppedForAppQuota) break;
      if (
        result.accountsProcessed >= maxAccounts ||
        !hasDeadlineBudget(deadline, MIN_EXTERNAL_OPERATION_BUDGET_MS)
      ) {
        result.stoppedForBudget = true;
        break;
      }
      result.usersConsidered += 1;

      assertDeadlineBudget(
        deadline,
        "carregar credenciais Meta",
        MIN_PERSISTENCE_START_BUDGET_MS,
      );
      const token = await ports.getCredentials(user.id, deadline);
      if (!token.ok) {
        result.stoppedForBudget = await skipUserWithoutToken({
          ports,
          deadline,
          runId,
          user,
          token,
          result,
          onlyStale,
          customerActionUserIds,
          onIssue: options.onIssue,
        });
        continue;
      }

      // Pré-cheque de cobertura, ANTES da descoberta de contas: com 32
      // disparos por noite, na maioria deles o usuário já está 100% coberto —
      // e mesmo assim cada tick pagava 2–3 chamadas de descoberta na Meta por
      // usuário. Se TODAS as contas já vistas estão cobertas no dia delas, não
      // há o que coletar: pula sem nenhuma chamada. Custos aceitos: uma conta
      // de anúncio recém-atribuída só entra na coleta quando alguma conta do
      // usuário voltar a ficar descoberta (o mais tardar, no primeiro tick do
      // dia seguinte); e a timezone usada é a da última cobertura — se mudou,
      // o erro é para o lado de redescobrir, nunca de pular.
      if (onlyStale) {
        assertDeadlineBudget(
          deadline,
          "pré-checar cobertura do usuário",
          MIN_PERSISTENCE_START_BUDGET_MS,
        );
        const known = await ports.listKnownAccountsForPrecheck(user.id, deadline);
        if (known.length > 0) {
          const coverages = await Promise.all(
            known.map((account) =>
              ports.getCoverageStatus({
                accountId: account.accountId,
                businessDate: businessDateFor(account, ports.now()),
                deadline,
              }),
            ),
          );
          if (coverages.every((covered) => isDayCoveredBy(covered))) {
            result.accountsSeen += known.length;
            result.accountsAlreadyCovered += known.length;
            continue;
          }
        }
      }

      let accounts: TrackedAdAccount[];
      result.discoveryAttempts += 1;
      try {
        assertDeadlineBudget(
          deadline,
          "descobrir contas do usuário",
          MIN_ACCOUNT_START_BUDGET_MS,
        );
        const listed = await ports.listAdAccounts({
          userId: user.id,
          credentials: token.credentials,
          deadline,
        });
        accounts = listed.accounts;
        observeAppQuota(result, listed.usage);
        result.graphApiCalls += listed.apiCalls;
      } catch (error) {
        if (isCollectionDeadlineExceeded(error)) {
          result.stoppedForBudget = true;
          break;
        }
        const invalidToken = tokenInvalidDetailsOf(error);
        if (invalidToken) {
          await ports.markConnectionNeedsReconnect({
            userId: user.id,
            connectionId: token.credentials.connectionId,
            ...invalidToken,
          });
          result.stoppedForBudget = await skipUserWithoutToken({
            ports,
            deadline,
            runId,
            user,
            token: {
              ok: false,
              needsReconnect: true,
              classification: "customer_action_required",
              message: RECONNECT_REQUIRED_MESSAGE,
            },
            result,
            onlyStale,
            customerActionUserIds,
            onIssue: options.onIssue,
          });
          continue;
        }
        result.discoveryFailures += 1;
        recordIssue({
          result,
          onIssue: options.onIssue,
          fallbackCategory: "external_transient",
          operation: "account_discovery",
          entity: "ad_account",
          userId: user.id,
          accountId: null,
          message: errorMessageOf(
            error,
            "Erro ao listar as contas de anúncio na Meta.",
          ),
          error,
        });
        if (recordAppRateLimitError(result, error)) break;
        continue;
      }

      result.accountsSeen += accounts.length;
      if (result.stoppedForAppQuota) break;

      for (
        let accountIndex = 0;
        accountIndex < accounts.length;
        accountIndex += 1
      ) {
        const account = accounts[accountIndex];
        const businessDate = businessDateFor(account, ports.now());

        if (onlyStale) {
          assertDeadlineBudget(
            deadline,
            "consultar cobertura da conta",
            MIN_PERSISTENCE_START_BUDGET_MS,
          );
          const covered = await ports.getCoverageStatus({
            accountId: account.accountId,
            businessDate,
            deadline,
          });
          if (isDayCoveredBy(covered)) {
            result.accountsAlreadyCovered += 1;
            continue;
          }
        }

        if (
          result.accountsProcessed >= maxAccounts ||
          !hasDeadlineBudget(deadline, MIN_ACCOUNT_START_BUDGET_MS)
        ) {
          result.stoppedForBudget = true;
          break;
        }

        result.accountsProcessed += 1;
        options.onAccountStart?.({
          runId,
          userRef: userRefOf(user.id),
          accountRef: accountRefOf(account.accountId),
        });
        const outcome = await collectAccount({
          ports,
          runId,
          user,
          account,
          businessDate,
          credentials: token.credentials,
          managedCampaignNamePrefix,
          result,
          deadline,
          onProgress: options.onProgress,
          onIssue: options.onIssue,
          customerActionUserIds,
        });
        if (outcome === "needs_reconnect") {
          for (const remaining of accounts.slice(accountIndex + 1)) {
            if (
              !hasDeadlineBudget(
                deadline,
                MIN_PERSISTENCE_START_BUDGET_MS,
              )
            ) {
              result.stoppedForBudget = true;
              break;
            }
            await skipDiscoveredAccountForReconnect({
              ports,
              deadline,
              runId,
              user,
              account: remaining,
              result,
              onlyStale,
            });
          }
          break;
        }
        if (result.stoppedForBudget || result.stoppedForAppQuota) break;
      }
    }

    await finishCompletedRun();

    return result;
  } catch (error) {
    if (runCreated && isCollectionDeadlineExceeded(error)) {
      result.stoppedForBudget = true;
      await finishCompletedRun();
      return result;
    }
    if (!runCreated) throw error;
    // Uma falha aqui é da infraestrutura da coleta (banco fora, regras do
    // negócio ilegíveis), não de uma conta: o run não pode ficar `running`
    // para sempre, senão o próximo disparo o encontra como travado.
    const issue = recordIssue({
      result,
      onIssue: options.onIssue,
      category: "internal_failure",
      operation: "run",
      entity: "run",
      message: errorMessageOf(error, "Coleta diária falhou"),
      error,
    });
    await ports.finishRun({
      runId,
      status: "failed",
      summary: summaryOf(),
      errorMessage: issue.message,
    });
    throw error;
  } finally {
    deadline.dispose();
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
  deadline: CollectionDeadline;
  runId: string;
  user: TrackedUser;
  token: {
    ok: false;
    needsReconnect: boolean;
    message: string;
    classification?: "customer_action_required" | "technical_failure";
  };
  result: DailyCollectionResult;
  onlyStale: boolean;
  customerActionUserIds: Set<string>;
  onIssue: DailyCollectionOptions["onIssue"];
}): Promise<boolean> {
  const {
    ports,
    deadline,
    runId,
    user,
    token,
    result,
    onlyStale,
    customerActionUserIds,
  } = args;
  const isCustomerAction =
    token.classification === "customer_action_required" ||
    (token.classification === undefined && token.needsReconnect);
  const status: MetaTrackingCoverageStatus = isCustomerAction
    ? coverageStatusForTokenFailure(token)
    : "failed";
  const message = sanitizeMetaLogText(token.message, 1_000);

  if (isCustomerAction) {
    noteCustomerActionRequired(result, customerActionUserIds, user.id);
    recordIssue({
      result,
      onIssue: args.onIssue,
      category: "customer_action_required",
      operation: "credential_lookup",
      entity: "user",
      userId: user.id,
      accountId: null,
      message,
    });
  } else {
    recordIssue({
      result,
      onIssue: args.onIssue,
      category: "internal_failure",
      operation: "credential_lookup",
      entity: "user",
      userId: user.id,
      accountId: null,
      message,
    });
  }

  if (!hasDeadlineBudget(deadline, MIN_PERSISTENCE_START_BUDGET_MS)) return true;
  const knownWithTimezone = await ports.listKnownAccountsForPrecheck(
    user.id,
    deadline,
  );
  const knownAccounts =
    knownWithTimezone.length > 0
      ? [
          ...new Map(
            knownWithTimezone.map((account) => [account.accountId, account]),
          ).values(),
        ]
      : [...new Set(await ports.listKnownAccountIds(user.id, deadline))].map(
          (accountId) => ({ accountId, timezoneName: null }),
        );

  if (knownAccounts.length === 0) {
    // Nunca coletado e sem token: não há conta a que atribuir a cobertura.
    // Fica no resumo do run para não virar silêncio.
    result.usersWithoutKnownAccounts += 1;
    return false;
  }

  const now = ports.now();
  for (const account of knownAccounts) {
    if (!hasDeadlineBudget(deadline, MIN_PERSISTENCE_START_BUDGET_MS)) return true;
    const businessDate = businessDateFor(account, now);
    if (onlyStale) {
      const covered = await ports.getCoverageStatus({
        accountId: account.accountId,
        businessDate,
        deadline,
      });
      if (isDayCoveredBy(covered)) {
        result.accountsAlreadyCovered += 1;
        continue;
      }
    }

    if (status === "failed") {
      result.accountsFailed += 1;
    } else {
      result.accountsSkipped += 1;
      if (status === "skipped_reconnect") {
        result.accountsSkippedReconnect += 1;
      }
    }
    await ports.recordCoverage({
      runId,
      userId: user.id,
      accountId: account.accountId,
      businessDate,
      status,
      errorMessage: message,
      entitiesSeen: 0,
      apiCallsUsed: 0,
      currency: null,
      timezoneName: account.timezoneName,
      completedAt: now,
    });
  }
  return false;
}

async function skipDiscoveredAccountForReconnect(args: {
  ports: DailyCollectionPorts;
  deadline: CollectionDeadline;
  runId: string;
  user: TrackedUser;
  account: TrackedAdAccount;
  result: DailyCollectionResult;
  onlyStale: boolean;
}): Promise<void> {
  const { ports, deadline, runId, user, account, result, onlyStale } = args;
  const businessDate = businessDateFor(account, ports.now());
  if (onlyStale) {
    const covered = await ports.getCoverageStatus({
      accountId: account.accountId,
      businessDate,
      deadline,
    });
    if (isDayCoveredBy(covered)) {
      result.accountsAlreadyCovered += 1;
      return;
    }
  }

  result.accountsSkipped += 1;
  result.accountsSkippedReconnect += 1;
  await ports.recordCoverage({
    runId,
    userId: user.id,
    accountId: account.accountId,
    businessDate,
    status: "skipped_reconnect",
    errorMessage: RECONNECT_REQUIRED_MESSAGE,
    entitiesSeen: 0,
    apiCallsUsed: 0,
    currency: account.currency,
    timezoneName: account.timezoneName,
    completedAt: ports.now(),
  });
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
  deadline: CollectionDeadline;
  onProgress: DailyCollectionOptions["onProgress"];
  onIssue: DailyCollectionOptions["onIssue"];
  customerActionUserIds: Set<string>;
}): Promise<"completed" | "needs_reconnect"> {
  const {
    ports,
    runId,
    user,
    account,
    businessDate,
    credentials,
    managedCampaignNamePrefix,
    result,
    deadline,
  } = args;

  const observedAt = ports.now();
  let usage: QuotaUsage = UNKNOWN_QUOTA_USAGE;
  let apiCallsUsed = 0;
  let entitiesSeen = 0;
  let metricRowsUpserted = 0;
  let status: MetaTrackingCoverageStatus = "complete";
  let errorMessage: string | null = null;
  let fatalError: SafeErrorSummary | undefined;
  let currentOperation: DailyCollectionOperation = "entity_listing";
  let currentEntity: DailyCollectionEntity = "ad_account";
  let needsReconnect = false;

  try {
    assertDeadlineBudget(
      deadline,
      "listar entidades da conta",
      MIN_EXTERNAL_OPERATION_BUDGET_MS,
    );
    const listing = await ports.listEntities({
      accountId: account.accountId,
      credentials,
      deadline,
    });
    usage = mergeQuotaUsage(usage, listing.usage);
    observeAppQuota(result, usage);
    apiCallsUsed += listing.apiCalls;
    entitiesSeen = listing.entities.length;
    const truncatedLevels = listing.truncatedLevels ?? [];
    result.listingPaginationTruncated += truncatedLevels.length;
    for (const entityLevel of truncatedLevels) {
      recordIssue({
        result,
        onIssue: args.onIssue,
        category: "degraded_component",
        operation: "entity_listing",
        entity: entityLevel,
        userId: user.id,
        accountId: account.accountId,
        message: `A listagem de ${entityLevel} atingiu o teto de páginas e foi truncada.`,
      });
    }

    assertDeadlineBudget(
      deadline,
      "carregar estado anterior da conta",
      MIN_PERSISTENCE_START_BUDGET_MS,
    );
    const previous = await ports.loadAccountState({
      userId: user.id,
      accountId: account.accountId,
      deadline,
    });

    let configs: TrackingConfigObservation[] = [];
    if (shouldStopForQuota(usage)) {
      // A listagem sozinha já apertou a cota: o ciclo de vida do dia é
      // registrado assim mesmo, e a configuração fica para o próximo disparo.
      status = "partial";
    } else {
      const plan = planDeepFetch({ listing: listing.entities, previous });
      assertDeadlineBudget(
        deadline,
        "buscar configurações da conta",
        MIN_EXTERNAL_OPERATION_BUDGET_MS,
      );
      const fetched = await ports.fetchConfigs({
        accountId: account.accountId,
        credentials,
        chunks: plan.chunks,
        usage,
        deadline,
      });
      usage = mergeQuotaUsage(usage, fetched.usage);
      observeAppQuota(result, usage);
      apiCallsUsed += fetched.apiCalls;
      configs = fetched.configs;
      if (fetched.stoppedForQuota || shouldStopForQuota(usage)) {
        status = "partial";
      }
    }

    // O que a plataforma já registrou com autor e motivo. Lido DEPOIS do fetch
    // (a janela conta a partir da observação) e antes do delta, que é quem sabe
    // o que fazer com isso.
    assertDeadlineBudget(
      deadline,
      "carregar mudanças internas recentes",
      MIN_PERSISTENCE_START_BUDGET_MS,
    );
    const internalChanges = await ports.loadRecentInternalChanges({
      accountId: account.accountId,
      since: new Date(observedAt.getTime() - INTERNAL_CHANGE_TOLERANCE_MS),
      deadline,
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

    currentOperation = "account_collection";
    assertDeadlineBudget(
      deadline,
      "persistir delta da conta",
      MIN_PERSISTENCE_START_BUDGET_MS,
    );
    const persisted = await ports.persistAccountDelta({
      runId,
      delta,
      deadline,
    });
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
      result.activityAccountsAttempted += 1;
      try {
        const activities = await ports.collectActivityEvents({
          userId: user.id,
          accountId: account.accountId,
          credentials,
          now: observedAt,
          deadline,
        });
        usage = mergeQuotaUsage(usage, activities.usage);
        observeAppQuota(result, usage);
        apiCallsUsed += activities.apiCalls;
        result.activityEventsUpserted += activities.eventsUpserted;
        result.activityEventsMatched += activities.eventsMatched;
        if (shouldStopForQuota(usage)) status = "partial";
        if (activities.paginationTruncated) {
          result.activityPaginationTruncated += 1;
          recordIssue({
            result,
            onIssue: args.onIssue,
            category: "degraded_component",
            operation: "activities",
            entity: "ad_account",
            userId: user.id,
            accountId: account.accountId,
            message:
              "O audit trail atingiu o teto de 25 páginas; parte do enriquecimento ficou pendente.",
          });
        }
      } catch (error) {
        if (isMetaTokenInvalid(error)) throw error;
        if (isCollectionDeadlineExceeded(error)) throw error;
        if (coverageStatusForCollectionError(error) === "partial") throw error;
        result.activityAccountsFailed += 1;
        recordIssue({
          result,
          onIssue: args.onIssue,
          category: "degraded_component",
          operation: "activities",
          entity: "ad_account",
          userId: user.id,
          accountId: account.accountId,
          message: `Audit trail da Meta indisponível; as ações do dia ficaram sem autor: ${errorMessageOf(error, "erro desconhecido")}`,
          error,
        });
      }
    }

    // Só quando a configuração fechou o dia: se a cota já apertou, gastar mais
    // chamadas com insights é justamente o que a postura de cota evita — e a
    // janela móvel de 28 dias devolve estes mesmos dias no próximo disparo.
    if (status === "complete") {
      currentOperation = "insights";
      result.insightsAccountsAttempted += 1;
      let metrics: DailyMetricsResult;
      try {
        metrics = await ports.collectDailyMetrics({
          userId: user.id,
          accountId: account.accountId,
          credentials,
          today: businessDate,
          usage,
          deadline,
        });
      } catch (error) {
        result.insightsAccountsFailed += 1;
        throw error;
      }
      usage = mergeQuotaUsage(usage, metrics.usage);
      observeAppQuota(result, usage);
      apiCallsUsed += metrics.apiCalls;
      metricRowsUpserted = metrics.rowsUpserted;
      result.metricSlicesDegraded += metrics.slicesDegraded;
      result.metricStrategyLoadFailures += metrics.strategyLoadFailures;
      result.metricStrategySaveFailures += metrics.strategySaveFailures;
      if (metrics.stoppedForQuota || shouldStopForQuota(usage)) {
        status = "partial";
      }

      for (const entityLevel of metrics.levelsAbandoned) {
        // Cobertura segue `complete`: o erro veio da Meta e insistir hoje só
        // aumentaria a taxa de erro do app. Fica visível no run, que é onde o
        // operador vê que aquele nível ficou sem série.
        result.insightsLevelsAbandoned += 1;
        if (entityLevel === "campaign") {
          result.insightsCampaignLevelsAbandoned += 1;
        } else if (entityLevel === "adset") {
          result.insightsAdsetLevelsAbandoned += 1;
        } else {
          result.insightsAdLevelsAbandoned += 1;
        }
        recordIssue({
          result,
          onIssue: args.onIssue,
          category: "degraded_component",
          operation: "insights",
          entity: entityLevel,
          userId: user.id,
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
    if (
      status === "complete" &&
      hasDeadlineBudget(deadline, MIN_EXTERNAL_OPERATION_BUDGET_MS)
    ) {
      currentOperation = "creative_content";
      currentEntity = "creative";
      result.creativeAccountsAttempted += 1;
      try {
        const creatives = await ports.collectCreativeSnapshots({
          userId: user.id,
          accountId: account.accountId,
          credentials,
          usage,
          deadline,
        });
        usage = mergeQuotaUsage(usage, creatives.usage);
        observeAppQuota(result, usage);
        result.appRateLimitEvents += creatives.appRateLimitEvents;
        if (creatives.appRateLimitEvents > 0) {
          result.stoppedForAppQuota = true;
        }
        apiCallsUsed += creatives.apiCalls;
        result.creativesFetched += creatives.creativesFetched;
        result.creativesPending += creatives.creativesPending;
        if (creatives.failureMessage) {
          result.creativeAccountsFailed += 1;
          recordIssue({
            result,
            onIssue: args.onIssue,
            category: "degraded_component",
            operation: "creative_content",
            entity: "creative",
            userId: user.id,
            accountId: account.accountId,
            message: `Conteúdo de criativos indisponível na Meta; ${creatives.creativesPending} criativo(s) seguem sem snapshot: ${creatives.failureMessage}`,
            errorSummary: creatives.failure,
          });
        }
      } catch (error) {
        if (isMetaTokenInvalid(error)) throw error;
        if (isCollectionDeadlineExceeded(error)) {
          // Configuração e métricas já estão checkpointadas. Criativos são
          // imutáveis e reaparecem na varredura seguinte; não reabre o dia.
          result.stoppedForBudget = true;
        } else if (isRateLimitError(error)) {
          throw error;
        } else {
          result.creativeAccountsFailed += 1;
          recordIssue({
            result,
            onIssue: args.onIssue,
            category: "degraded_component",
            operation: "creative_content",
            entity: "creative",
            userId: user.id,
            accountId: account.accountId,
            message: `Não foi possível capturar o conteúdo dos criativos: ${errorMessageOf(error, "erro desconhecido")}`,
            error,
          });
        }
      }
    } else if (status === "complete") {
      result.stoppedForBudget = true;
    }
  } catch (error) {
    if (isCollectionDeadlineExceeded(error)) {
      status = "partial";
      errorMessage = BUDGET_STOP_MESSAGE;
      result.stoppedForBudget = true;
    } else {
      const invalidToken = tokenInvalidDetailsOf(error);
      if (invalidToken) {
        await ports.markConnectionNeedsReconnect({
          userId: user.id,
          connectionId: credentials.connectionId,
          ...invalidToken,
        });
        status = "skipped_reconnect";
        errorMessage = RECONNECT_REQUIRED_MESSAGE;
        needsReconnect = true;
        noteCustomerActionRequired(
          result,
          args.customerActionUserIds,
          user.id,
        );
        recordIssue({
          result,
          onIssue: args.onIssue,
          category: "customer_action_required",
          operation: currentOperation,
          entity: currentEntity,
          userId: user.id,
          accountId: account.accountId,
          message: errorMessage,
          error,
        });
      } else {
        // Throttle ou indisponibilidade explicitamente transitória vira
        // `partial`: o cron seguinte fornece o cooldown sem retry imediato.
        status = coverageStatusForCollectionError(error);
        recordAppRateLimitError(result, error);
        errorMessage = errorMessageOf(error, "Erro ao coletar a conta na Meta.");
        fatalError = safeErrorSummary(error, errorMessage);
        recordIssue({
          result,
          onIssue: args.onIssue,
          operation: currentOperation,
          entity: currentEntity,
          userId: user.id,
          accountId: account.accountId,
          message: errorMessage,
          errorSummary: fatalError,
          error,
        });
      }
    }
  }

  if (!hasDeadlineBudget(deadline)) {
    result.stoppedForBudget = true;
  }
  result.metricRowsUpserted += metricRowsUpserted;
  result.graphApiCalls += apiCallsUsed;

  if (status === "complete") result.accountsCovered += 1;
  else if (status === "partial") result.accountsPartial += 1;
  else if (status === "skipped_reconnect") {
    result.accountsSkipped += 1;
    result.accountsSkippedReconnect += 1;
  } else result.accountsFailed += 1;

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
    runId,
    userRef: userRefOf(user.id),
    accountRef: accountRefOf(account.accountId),
    status,
    metricRowsUpserted,
    errorMessage,
    error: fatalError,
  });
  return needsReconnect ? "needs_reconnect" : "completed";
}
