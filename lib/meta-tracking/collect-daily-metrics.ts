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
};

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
  /** Upsert por (nível, entidade, dia); devolve quantas linhas gravou. */
  upsertRows: (rows: readonly DailyMetricRow[]) => Promise<number>;
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
};

export type DailyMetricsResult = {
  rowsUpserted: number;
  usage: QuotaUsage;
  apiCalls: number;
  /** A coleta parou no meio para não estourar a cota da conta. */
  stoppedForQuota: boolean;
  /** Quantas vezes um período precisou ser partido por volume de linhas. */
  slicesDegraded: number;
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
    levelsAbandoned: [],
  };

  for (const entityLevel of METRIC_LEVELS) {
    if (shouldStopForQuota(result.usage)) {
      result.stoppedForQuota = true;
      break;
    }

    const raw = await fetchLevel({
      ports,
      accountId: args.accountId,
      credentials: args.credentials,
      entityLevel,
      fullRange: targetRange,
      result,
    });
    const rows = toDailyMetricRows({
      userId: args.userId,
      accountId: args.accountId,
      entityLevel,
      today: args.today,
      rows: raw,
    });

    if (rows.length > 0) {
      result.rowsUpserted += await ports.upsertRows(rows);
    }

    if (result.stoppedForQuota) break;
  }

  return result;
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
  result: DailyMetricsResult;
}): Promise<RawInsightsRow[]> {
  const { ports, accountId, credentials, entityLevel, result } = args;
  const pending: InsightsRange[] = [args.fullRange];
  const rows: RawInsightsRow[] = [];

  while (pending.length > 0) {
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
      });
      result.usage = mergeQuotaUsage(result.usage, fetched.usage);
      result.apiCalls += fetched.apiCalls;
      rows.push(...fetched.rows);
    } catch (error) {
      if (!isInsightsTooHeavyError(error)) throw error;

      const halves = splitInsightsRange(range);
      if (halves.length > 0) {
        result.slicesDegraded += 1;
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
        break;
      }
      try {
        const fetched = await ports.fetchInsightsAsync({
          accountId,
          credentials,
          entityLevel,
          range: args.fullRange,
        });
        result.usage = mergeQuotaUsage(result.usage, fetched.usage);
        result.apiCalls += fetched.apiCalls;
        result.slicesDegraded += 1;
        return fetched.rows;
      } catch (asyncError) {
        // Volume que estoura até no relatório assíncrono não tem mais recurso.
        // Qualquer outra falha sobe: o operador precisa ver o job que quebrou.
        if (!isInsightsTooHeavyError(asyncError)) throw asyncError;
        result.levelsAbandoned.push(entityLevel);
        break;
      }
    }
  }

  return rows;
}
