/**
 * O passo de resultados do coletor diário (§5.6 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Etapa separada e injetável de propósito: recebe duas portas — buscar insights
 * de um nível num período e gravar linhas — e coordena os três níveis, a janela
 * móvel, o recuo por volume e a parada por cota. Nada aqui fala HTTP ou SQL, e é
 * isso que permite exercitar a degradação (o comportamento mais difícil de
 * observar em produção) com portas falsas.
 *
 * O backfill (§6 do plano) reaproveita a mesma decomposição trocando o período
 * pelos 13 meses e as portas pelo job assíncrono de insights.
 *
 * ## A ordem, e por que ela é essa
 *
 * 1. **Nível a nível, do pai para o filho.** O nível de anúncio é o primeiro a
 *    estourar o teto de linhas de uma conta grande; deixá-lo por último garante
 *    que campanha e conjunto já estejam gravados quando isso acontecer.
 * 2. **Grava a cada nível, não no fim.** Uma falha no nível seguinte não desfaz
 *    o que já veio — a série é a única cópia que existirá depois que a janela de
 *    37 meses da Meta passar.
 * 3. **Cota antes de cada consulta.** A licença do app é throttled por taxa de
 *    erro: parar com o dia incompleto é barato (a janela de 28 dias re-coleta
 *    tudo amanhã), tomar 429 não é.
 * 4. **O recuo por volume tem três degraus, nesta ordem** (§5.6 do plano):
 *    período partido ao meio → job assíncrono da Meta pelo período inteiro →
 *    nível abandonado no dia. O assíncrono é o último porque custa espera; o
 *    abandono é o fim porque nem ele deu conta.
 */

import {
  isInsightsTooHeavyError,
  metricsWindowFor,
  partitionInsightsRange,
  rangeDays,
  splitInsightsRange,
  toDailyMetricRows,
  type DailyMetricRow,
  type InsightsRange,
  type RawInsightsRow,
} from "@/lib/meta-tracking/daily-metrics";
import {
  mergeQuotaUsage,
  shouldStopForQuota,
  UNKNOWN_QUOTA_USAGE,
  type QuotaUsage,
} from "@/lib/meta-tracking/quota-usage";
import {
  assertDeadlineBudget,
  MIN_EXTERNAL_OPERATION_BUDGET_MS,
  MIN_PERSISTENCE_START_BUDGET_MS,
  type CollectionDeadline,
} from "@/lib/meta-tracking/collection-deadline";
import type { DayKey } from "@/lib/meta-tracking/correlation";
import type { TrackingCredentials } from "@/lib/meta-tracking/run-daily-collection";
import type { MetaTrackingEntityLevel } from "@/lib/db/schema";

/** Do pai para o filho — ver "A ordem" no cabeçalho. */
const METRIC_LEVELS: readonly MetaTrackingEntityLevel[] = [
  "campaign",
  "adset",
  "ad",
];

export type InsightsFetchResult = {
  rows: RawInsightsRow[];
  usage: QuotaUsage;
  apiCalls: number;
};

export type InsightsFetchArgs = {
  accountId: string;
  credentials: TrackingCredentials;
  entityLevel: MetaTrackingEntityLevel;
  range: InsightsRange;
  deadline?: CollectionDeadline;
};

/**
 * Último degrau que completou este nível da conta.
 *
 * `sync` guarda o maior tamanho conservador de fatia: ele só diminui quando uma
 * janela antes segura volta a estourar. `async` é terminal na escada
 * split → async → abandon e evita repetir todas as sondagens síncronas que já
 * provaram não caber. O `async` sempre representa sucesso do job para
 * `fullRange`: o dia único que falhou só dispara esse degrau, nunca é promovido
 * por engano ao período inteiro na execução seguinte.
 */
export type InsightsFetchStrategy =
  | { mode: "sync"; maxRangeDays: number }
  | { mode: "async" };

export type InsightsFetchStrategies = Partial<
  Record<MetaTrackingEntityLevel, InsightsFetchStrategy>
>;

export type DailyMetricsPorts = {
  /** Insights de um nível num período, já paginados. */
  fetchInsights: (args: InsightsFetchArgs) => Promise<InsightsFetchResult>;
  /**
   * O último recurso do recuo por volume (§5.6 do plano): o job assíncrono da
   * Meta, que aceita relatórios muito maiores em troca de espera. Opcional
   * porque quem já ENTRA pelo caminho assíncrono — o backfill — não tem para
   * onde recuar depois dele.
   */
  fetchInsightsAsync?: (args: InsightsFetchArgs) => Promise<InsightsFetchResult>;
  /** Estratégias aprendidas em execuções anteriores desta conta. */
  loadInsightsStrategies?: (args: {
    accountId: string;
    deadline?: CollectionDeadline;
  }) => Promise<InsightsFetchStrategies>;
  /**
   * Persiste somente um degrau novo e bem-sucedido. A implementação real faz
   * upsert monotônico para uma corrida nunca voltar a uma janela mais larga.
   */
  saveInsightsStrategy?: (args: {
    accountId: string;
    entityLevel: MetaTrackingEntityLevel;
    strategy: InsightsFetchStrategy;
    deadline?: CollectionDeadline;
  }) => Promise<void>;
  /** Upsert por (nível, entidade, dia); devolve quantas linhas gravou. */
  upsertRows: (
    rows: readonly DailyMetricRow[],
    deadline?: CollectionDeadline,
  ) => Promise<number>;
};

export type CollectDailyMetricsArgs = {
  userId: string;
  accountId: string;
  credentials: TrackingCredentials;
  /** Hoje na timezone da conta — define a janela e o que já congelou. */
  today: DayKey;
  /**
   * Período a coletar. Ausente = a janela móvel de 28 dias da coleta diária; o
   * backfill passa a fatia de passado que está capturando. `today` continua
   * mandando no `is_final`, então o passo nunca congela um dia que ainda muda.
   */
  range?: InsightsRange;
  /** Cota já gasta pelas etapas anteriores da conta. */
  usage?: QuotaUsage;
  /** Deadline absoluto da coleta diária; scripts de backfill podem omiti-lo. */
  deadline?: CollectionDeadline;
};

export type DailyMetricsResult = {
  rowsUpserted: number;
  usage: QuotaUsage;
  apiCalls: number;
  /** A coleta parou no meio para não estourar a cota da conta. */
  stoppedForQuota: boolean;
  /**
   * Quantas decisões de recuo foram usadas: partição por volume, modo
   * assíncrono ou reaplicação de uma estratégia aprendida. Um fallback que
   * completou continua visível como degradação tratada.
   */
  slicesDegraded: number;
  /** Leitura da otimização falhou; a coleta seguiu pela estratégia padrão. */
  strategyLoadFailures: number;
  /**
   * Escrita do aprendizado falhou depois dos dados; a próxima run pode
   * reaprender, mas esta coleta continua válida.
   */
  strategySaveFailures: number;
  /**
   * Níveis que estouraram o teto de linhas até num dia único e ficaram sem
   * série hoje. Não é motivo para tentar de novo no mesmo dia: o erro veio da
   * Meta e insistir só piora a taxa de erro do app.
   */
  levelsAbandoned: MetaTrackingEntityLevel[];
};

export async function collectDailyMetrics(
  ports: DailyMetricsPorts,
  args: CollectDailyMetricsArgs,
): Promise<DailyMetricsResult> {
  // Chamado de "período", e não de "janela": para a coleta diária é a janela
  // móvel de 28 dias; para o backfill é a fatia de passado que ele está
  // capturando. O passo trata os dois igual.
  const targetRange = args.range ?? metricsWindowFor(args.today);

  const result: DailyMetricsResult = {
    rowsUpserted: 0,
    usage: args.usage ?? UNKNOWN_QUOTA_USAGE,
    apiCalls: 0,
    stoppedForQuota: false,
    slicesDegraded: 0,
    strategyLoadFailures: 0,
    strategySaveFailures: 0,
    levelsAbandoned: [],
  };

  let preferredStrategies: InsightsFetchStrategies = {};
  if (!shouldStopForQuota(result.usage) && ports.loadInsightsStrategies) {
    try {
      preferredStrategies = await ports.loadInsightsStrategies({
        accountId: args.accountId,
        deadline: args.deadline,
      });
    } catch {
      // Esta tabela é só memória de otimização. Durante rollout (ou numa falha
      // pontual do Postgres), ausência dela não pode transformar uma coleta
      // funcional em falha nem expor SQL/identificadores no resultado.
      result.strategyLoadFailures += 1;
    }
  }

  for (const entityLevel of METRIC_LEVELS) {
    assertDeadlineBudget(
      args.deadline,
      `iniciar insights de ${entityLevel}`,
      MIN_EXTERNAL_OPERATION_BUDGET_MS,
    );
    if (shouldStopForQuota(result.usage)) {
      result.stoppedForQuota = true;
      break;
    }

    const fetchedLevel = await fetchLevel({
      ports,
      accountId: args.accountId,
      credentials: args.credentials,
      entityLevel,
      fullRange: targetRange,
      preferredStrategy: preferredStrategies[entityLevel],
      result,
      deadline: args.deadline,
    });
    const learnedStrategyChanged =
      fetchedLevel.completed &&
      fetchedLevel.learnedStrategy !== undefined &&
      !sameInsightsStrategy(
        preferredStrategies[entityLevel],
        fetchedLevel.learnedStrategy,
      );

    const rows = toDailyMetricRows({
      userId: args.userId,
      accountId: args.accountId,
      entityLevel,
      today: args.today,
      rows: fetchedLevel.rows,
    });

    if (rows.length > 0) {
      assertDeadlineBudget(
        args.deadline,
        `persistir insights de ${entityLevel}`,
        MIN_PERSISTENCE_START_BUDGET_MS,
      );
      result.rowsUpserted += await ports.upsertRows(rows, args.deadline);
    }

    if (
      learnedStrategyChanged &&
      fetchedLevel.learnedStrategy &&
      ports.saveInsightsStrategy
    ) {
      try {
        // Depois do upsert: perder esta escrita perde só o aprendizado, nunca
        // as métricas que a estratégia acabou de recuperar.
        await ports.saveInsightsStrategy({
          accountId: args.accountId,
          entityLevel,
          strategy: fetchedLevel.learnedStrategy,
          deadline: args.deadline,
        });
        preferredStrategies[entityLevel] = fetchedLevel.learnedStrategy;
      } catch {
        result.strategySaveFailures += 1;
      }
    }

    if (result.stoppedForQuota) break;
  }

  return result;
}

function sameInsightsStrategy(
  left: InsightsFetchStrategy | undefined,
  right: InsightsFetchStrategy,
): boolean {
  if (!left || left.mode !== right.mode) return false;
  return (
    left.mode === "async" ||
    (right.mode === "sync" && left.maxRangeDays === right.maxRangeDays)
  );
}

/**
 * Um nível inteiro, encolhendo o período sempre que a Meta reclamar do volume.
 *
 * As fatias entram na FRENTE da pilha para que o período seja percorrido em
 * ordem cronológica mesmo depois de partido — o que mantém a resposta legível no
 * log e a série contígua se a cota interromper no meio.
 */
async function fetchLevel(args: {
  ports: DailyMetricsPorts;
  accountId: string;
  credentials: TrackingCredentials;
  entityLevel: MetaTrackingEntityLevel;
  /** O período do nível inteiro, antes de qualquer recuo por volume. */
  fullRange: InsightsRange;
  preferredStrategy?: InsightsFetchStrategy;
  result: DailyMetricsResult;
  deadline?: CollectionDeadline;
}): Promise<{
  rows: RawInsightsRow[];
  completed: boolean;
  learnedStrategy?: InsightsFetchStrategy;
}> {
  const {
    ports,
    accountId,
    credentials,
    entityLevel,
    preferredStrategy,
    result,
    deadline,
  } = args;

  if (preferredStrategy?.mode === "async" && ports.fetchInsightsAsync) {
    try {
      assertDeadlineBudget(
        deadline,
        `iniciar estratégia assíncrona de ${entityLevel}`,
        MIN_EXTERNAL_OPERATION_BUDGET_MS,
      );
      const fetched = await ports.fetchInsightsAsync({
        accountId,
        credentials,
        entityLevel,
        range: args.fullRange,
        deadline,
      });
      result.usage = mergeQuotaUsage(result.usage, fetched.usage);
      result.apiCalls += fetched.apiCalls;
      result.slicesDegraded += 1;
      return {
        rows: fetched.rows,
        completed: true,
        learnedStrategy: preferredStrategy,
      };
    } catch (error) {
      if (!isInsightsTooHeavyError(error)) throw error;
      result.levelsAbandoned.push(entityLevel);
      return { rows: [], completed: false };
    }
  }

  const fullRangeDays = rangeDays(args.fullRange);
  const preferredSyncMaxRangeDays =
    preferredStrategy?.mode === "sync" &&
    preferredStrategy.maxRangeDays < fullRangeDays
      ? preferredStrategy.maxRangeDays
      : null;
  const pending: InsightsRange[] =
    preferredSyncMaxRangeDays === null
      ? [args.fullRange]
      : partitionInsightsRange(args.fullRange, preferredSyncMaxRangeDays);
  const rows: RawInsightsRow[] = [];
  let learnedMaxRangeDays: number | null = null;
  let abandoned = false;

  if (preferredSyncMaxRangeDays !== null) {
    // Mesmo sem novo erro, este nível completou por uma estratégia degradada e
    // precisa continuar aparecendo no contador operacional.
    result.slicesDegraded += 1;
  }

  while (pending.length > 0) {
    assertDeadlineBudget(
      deadline,
      `buscar insights de ${entityLevel}`,
      MIN_EXTERNAL_OPERATION_BUDGET_MS,
    );
    if (shouldStopForQuota(result.usage)) {
      result.stoppedForQuota = true;
      break;
    }

    const range = pending.shift()!;
    try {
      const fetched = await ports.fetchInsights({
        accountId,
        credentials,
        entityLevel,
        range,
        deadline,
      });
      result.usage = mergeQuotaUsage(result.usage, fetched.usage);
      result.apiCalls += fetched.apiCalls;
      rows.push(...fetched.rows);
    } catch (error) {
      if (!isInsightsTooHeavyError(error)) throw error;

      const halves = splitInsightsRange(range);
      if (halves.length > 0) {
        result.slicesDegraded += 1;
        const conservativeHalfDays = Math.min(...halves.map(rangeDays));
        learnedMaxRangeDays =
          learnedMaxRangeDays === null
            ? conservativeHalfDays
            : Math.min(learnedMaxRangeDays, conservativeHalfDays);
        pending.unshift(...halves);
        continue;
      }

      // Nem um dia único cabe no caminho síncrono: fatiar mais é impossível e
      // insistir por dia geraria um job assíncrono para cada dia da janela. O
      // job assíncrono aceita relatórios muito maiores — vai o período INTEIRO
      // de uma vez, e o que já veio pelas fatias é descartado porque a resposta
      // dele cobre tudo.
      //
      // O `break` lá embaixo é também o que segura a taxa de erro do app: a
      // descida é uma só (a fatia da frente é sempre a próxima tentada), então
      // um nível que falha do começo ao fim gasta ~log2(dias) chamadas, não uma
      // árvore inteira de fatias condenadas.
      if (!ports.fetchInsightsAsync) {
        result.levelsAbandoned.push(entityLevel);
        abandoned = true;
        break;
      }
      try {
        assertDeadlineBudget(
          deadline,
          `iniciar fallback assíncrono de ${entityLevel}`,
          MIN_EXTERNAL_OPERATION_BUDGET_MS,
        );
        const fetched = await ports.fetchInsightsAsync({
          accountId,
          credentials,
          entityLevel,
          range: args.fullRange,
          deadline,
        });
        result.usage = mergeQuotaUsage(result.usage, fetched.usage);
        result.apiCalls += fetched.apiCalls;
        result.slicesDegraded += 1;
        return {
          rows: fetched.rows,
          completed: true,
          // O modo só é aprendido depois de o job pelo PERÍODO INTEIRO
          // completar. A fatia de um dia apenas disparou o degrau; não é ela
          // que será indevidamente ampliada na execução seguinte.
          learnedStrategy: { mode: "async" },
        };
      } catch (asyncError) {
        // Volume que estoura até no relatório assíncrono não tem mais recurso.
        // Qualquer outra falha sobe: o operador precisa ver o job que quebrou.
        if (!isInsightsTooHeavyError(asyncError)) throw asyncError;
        result.levelsAbandoned.push(entityLevel);
        abandoned = true;
        break;
      }
    }
  }

  return {
    rows,
    completed:
      pending.length === 0 && !result.stoppedForQuota && !abandoned,
    learnedStrategy:
      learnedMaxRangeDays === null
        ? undefined
        : { mode: "sync", maxRangeDays: learnedMaxRangeDays },
  };
}
