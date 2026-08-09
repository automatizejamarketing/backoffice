/**
 * A série diária de resultados: o que é um dia de métrica, quando ele congela e
 * como uma resposta de insights vira linhas de `meta_tracking_daily_metrics`
 * (§4.2 e §5.6 do plano `docs/plans/campaign-tracking-foundation.md`).
 *
 * Tudo aqui é decisão pura. Quem fala com a Graph API é
 * `graph-insights-gateway.ts`, quem fala com o Postgres é
 * `lib/db/meta-tracking-metrics-queries.ts`, e quem coordena os dois é
 * `collect-daily-metrics.ts` — nenhum dos três decide nada.
 *
 * ## As três decisões que este arquivo carrega
 *
 * 1. **A janela móvel.** A Meta reescreve os insights de um dia por até 28 dias
 *    (atribuição retroativa) e só então congela. A coleta reescreve a janela
 *    inteira todo dia por upsert; nada é deletado, nunca.
 * 2. **Quando o dia vira final.** O dia que está saindo da janela está sendo
 *    coletado pela ÚLTIMA vez — é aí que ele nasce `is_final`. Marcar depois
 *    seria tarde demais: ele já não seria mais re-escrito.
 * 3. **O que é uma linha.** Numéricos universais em colunas tipadas, famílias de
 *    cardinalidade variável (ações, valores, custos) em JSONB, exatamente como a
 *    Meta entrega.
 *
 * ## Unidades de dinheiro — a armadilha desta fundação
 *
 * `spend` e `action_values` dos insights vêm em unidades MAIORES da moeda da
 * conta (`"12.34"` = R$ 12,34), enquanto `daily_budget`/`lifetime_budget`/
 * `spend_cap`/`bid_amount` das versões de configuração vêm em unidades MENORES
 * (`"5000"` = R$ 50,00). As duas escalas convivem no mesmo banco. Este módulo
 * persiste o que a Meta entrega, sem converter: qualquer soma ou comparação
 * entre gasto e orçamento precisa converter primeiro, e quem converter tem de
 * fazê-lo no ponto de consumo, com a moeda da conta em mãos.
 */

import { isDayKey, shiftDayKey, type DayKey } from "@/lib/meta-tracking/correlation";
import type { MetaTrackingEntityLevel } from "@/lib/db/schema";

/**
 * Dias em que os insights de uma data ainda mudam. Documentado pela Meta: a
 * atribuição retroativa se acomoda em até 28 dias e depois congela.
 */
export const METRICS_MUTABLE_DAYS = 28;

/** Um período de calendário fechado, como a Meta o recebe em `time_range`. */
export type InsightsRange = { since: DayKey; until: DayKey };

/**
 * A janela móvel a re-coletar hoje: do dia que está congelando até hoje.
 *
 * Inclui a borda (`hoje − 28`) de propósito — é a última chance de gravá-la, e é
 * exatamente o dia que `isFinalMetricDay` marca como final. Assim um dia sai da
 * janela no mesmo instante em que passa a ser imutável, sem buraco entre as duas
 * regras.
 */
export function metricsWindowFor(today: DayKey): InsightsRange {
  return { since: shiftDayKey(today, -METRICS_MUTABLE_DAYS), until: today };
}

/**
 * O valor deste dia ainda pode mudar?
 *
 * Final quando a janela de atribuição já se fechou inteira — o que acontece
 * justamente no dia em que a re-coleta o alcança pela última vez.
 */
export function isFinalMetricDay(metricDate: DayKey, today: DayKey): boolean {
  return metricDate <= shiftDayKey(today, -METRICS_MUTABLE_DAYS);
}

/** Dias de calendário no período, inclusive; `0` quando o período é vazio. */
export function rangeDays(range: InsightsRange): number {
  const days = Math.round(dayIndex(range.until) - dayIndex(range.since)) + 1;
  return days > 0 ? days : 0;
}

function dayIndex(day: DayKey): number {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, dayOfMonth, 12) / 86_400_000;
}

/**
 * O período partido ao meio, para o recuo por volume de linhas.
 *
 * A Meta rejeita a consulta inteira quando o resultado passaria do teto de
 * linhas (erro 100, subcódigo 1487534) — o nível de anúncio de uma conta grande
 * é o primeiro a estourar. As metades cobrem o período inteiro sem sobrepor,
 * então repetir a consulta em fatias devolve exatamente a mesma série.
 *
 * Devolve lista VAZIA quando não há mais o que encolher (um dia só, ou período
 * invertido): quem chamou precisa distinguir "tento menor" de "desisto deste
 * nível", e um dia único que ainda estoura o teto não tem recuo possível.
 */
export function splitInsightsRange(range: InsightsRange): InsightsRange[] {
  const days = rangeDays(range);
  if (days < 2) return [];

  const firstHalfEnd = shiftDayKey(range.since, Math.floor(days / 2) - 1);
  return [
    { since: range.since, until: firstHalfEnd },
    { since: shiftDayKey(firstHalfEnd, 1), until: range.until },
  ];
}

/** Erro de parâmetro inválido da Meta; o subcódigo é que diz o que houve. */
const INSIGHTS_ERROR_CODE = 100;

/** "Reduza o intervalo de datas": o teto de linhas do relatório estourou. */
const INSIGHTS_ROW_LIMIT_SUBCODE = 1487534;

/**
 * O erro é "resultado grande demais"?
 *
 * Reconhecido pela FORMA do erro, não por `instanceof GraphApiError`: a classe
 * mora num módulo que arrasta o log observável (e, com ele, o runtime do Next)
 * para dentro de uma costura que precisa ser pura. A forma é estável — é a que
 * `parseGraphError` produz — e um erro de outra origem simplesmente não casa.
 */
export function isInsightsRowLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const data = (
    error as {
      errorReturn?: { data?: { code?: unknown; errorSubcode?: unknown } };
    }
  ).errorReturn?.data;
  return (
    data?.code === INSIGHTS_ERROR_CODE &&
    data?.errorSubcode === INSIGHTS_ROW_LIMIT_SUBCODE
  );
}

/** Uma linha de `meta_tracking_daily_metrics` pronta para upsert. */
export type DailyMetricRow = {
  userId: string;
  accountId: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  campaignId: string | null;
  adsetId: string | null;
  metricDate: DayKey;
  /** Unidades MAIORES da moeda da conta, como a Meta entrega. */
  spend: string | null;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  frequency: string | null;
  actions: unknown;
  actionValues: unknown;
  costPerActionType: unknown;
  costPerResult: unknown;
  purchaseRoas: unknown;
  websitePurchaseRoas: unknown;
  isFinal: boolean;
};

/** Uma linha de insights como a Meta a entrega: tudo opaco, tudo string. */
export type RawInsightsRow = Record<string, unknown>;

/**
 * Qual campo da resposta identifica a entidade em cada nível. É por ele que a
 * linha é aceita ou descartada: sem id não há a que ligar o resultado, e
 * adivinhar (usar o `campaign_id` de uma linha de conjunto, por exemplo) criaria
 * série falsa no nível errado.
 */
const ENTITY_ID_FIELD: Record<MetaTrackingEntityLevel, string> = {
  campaign: "campaign_id",
  adset: "adset_id",
  ad: "ad_id",
};

/*
 * Os quatro coercitivos abaixo parecem os de `config-version.ts`, mas NÃO são os
 * mesmos e não devem ser unificados: lá a pergunta é "o que a configuração
 * diz" (número que chega como número é suspeito; qualquer valor serve para o
 * jsonb); aqui é "quanto foi entregue" (a Meta manda contagem como string, e as
 * famílias são sempre listas — escalar ali é resposta corrompida, não dado).
 */

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value.trim() : String(value);
  return raw.length > 0 ? raw : null;
}

/**
 * Contagem inteira. A Meta manda tudo como string; o que não for número
 * utilizável vira `null` — ausência de métrica não é zero, e gravar zero
 * apagaria a diferença entre "não houve" e "não veio".
 */
function count(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/**
 * Decimal destinado a coluna `numeric`. Fica STRING de propósito: converter para
 * `number` perderia precisão de dinheiro, e o Postgres aceita o texto tal como
 * a Meta o escreveu.
 */
function decimal(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  return Number.isFinite(Number(raw)) ? raw : null;
}

/** Famílias de cardinalidade variável: guardadas cruas, ou `null`. */
function jsonOrNull(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return typeof value === "object" ? value : null;
}

export type ToDailyMetricRowsInput = {
  userId: string;
  accountId: string;
  entityLevel: MetaTrackingEntityLevel;
  /** Hoje na timezone da conta — é ele que decide o que já congelou. */
  today: DayKey;
  rows: readonly RawInsightsRow[];
};

/**
 * A resposta de insights de um nível vira linhas da série diária.
 *
 * Descarta o que não dá para gravar sem inventar (sem id da entidade, sem dia
 * utilizável) e colapsa repetições de `(entidade, dia)` na última ocorrência:
 * um `INSERT … ON CONFLICT DO UPDATE` com a mesma chave duas vezes no mesmo
 * comando é erro do Postgres, não upsert, e fatiar o período por volume de
 * linhas é justamente o que pode trazer o mesmo dia duas vezes.
 */
export function toDailyMetricRows(
  input: ToDailyMetricRowsInput,
): DailyMetricRow[] {
  const idField = ENTITY_ID_FIELD[input.entityLevel];
  const byEntityDay = new Map<string, DailyMetricRow>();

  for (const raw of input.rows) {
    const entityId = text(raw[idField]);
    const metricDate = text(raw["date_start"]);
    if (entityId === null || metricDate === null || !isDayKey(metricDate)) {
      continue;
    }

    byEntityDay.set(`${entityId}|${metricDate}`, {
      userId: input.userId,
      accountId: input.accountId,
      entityLevel: input.entityLevel,
      entityId,
      campaignId:
        input.entityLevel === "campaign" ? null : text(raw["campaign_id"]),
      adsetId: input.entityLevel === "ad" ? text(raw["adset_id"]) : null,
      metricDate,
      spend: decimal(raw["spend"]),
      impressions: count(raw["impressions"]),
      clicks: count(raw["clicks"]),
      reach: count(raw["reach"]),
      frequency: decimal(raw["frequency"]),
      actions: jsonOrNull(raw["actions"]),
      actionValues: jsonOrNull(raw["action_values"]),
      costPerActionType: jsonOrNull(raw["cost_per_action_type"]),
      costPerResult: jsonOrNull(raw["cost_per_result"]),
      purchaseRoas: jsonOrNull(raw["purchase_roas"]),
      websitePurchaseRoas: jsonOrNull(raw["website_purchase_roas"]),
      isFinal: isFinalMetricDay(metricDate, input.today),
    });
  }

  return [...byEntityDay.values()];
}
