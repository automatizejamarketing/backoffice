/**
 * As decisões do backfill de 13 meses (§6 do plano
 * `docs/plans/campaign-tracking-foundation.md`), todas puras.
 *
 * O executor do backfill é fino: ele fala com a Graph API e com o Postgres e não
 * decide nada. O que é decisão mora aqui — qual período capturar, o que já foi
 * capturado, como fatiar o que falta, quem entra no baseline de configuração e
 * quando a noite acabou para esta conta.
 *
 * ## As quatro decisões que este arquivo carrega
 *
 * 1. **O alvo é só o passado congelado.** A janela de 37 meses da Meta desliza
 *    todo dia; o que não for capturado agora some para sempre. Mas o backfill
 *    para onde a janela móvel do coletor diário começa: os últimos 29 dias ainda
 *    mudam por atribuição retroativa e já têm dono. Assim nenhum dia fica sem
 *    dono e nenhum é disputado por dois processos que gravariam valores
 *    diferentes no mesmo lugar.
 * 2. **O progresso é um conjunto de períodos, não um cursor.** Uma fatia que
 *    terminou vira período coberto; o que falta é subtração. Interromper no meio
 *    (timeout, cota, erro da Meta) não perde nada nem obriga a refazer período
 *    completo, e a ordem em que as fatias foram executadas deixa de importar.
 * 3. **A história recente primeiro.** As fatias saem do mais recente para o mais
 *    antigo: se o backfill nunca terminar, o que já entrou é o passado mais
 *    próximo — o mais parecido com o presente e o mais útil para decidir hoje.
 * 4. **O baseline vê todo mundo, menos quem foi removido.** É o único momento em
 *    que pausadas e arquivadas ganham versão de configuração (§6 do plano); daí
 *    em diante o coletor diário volta a ignorá-las até reativarem. Removidas
 *    ficam de fora porque o node batch da Graph API falha INTEIRO quando um id
 *    não resolve, e um id removido derrubaria o lote dos outros 49.
 */

import { shiftDayKey, type DayKey } from "@/lib/meta-tracking/correlation";
import {
  METRICS_MUTABLE_DAYS,
  rangeDays,
  type InsightsRange,
} from "@/lib/meta-tracking/daily-metrics";
import {
  chunkIds,
  DEEP_FETCH_CHUNK_SIZE,
  type DeepFetchChunk,
  type ListedEntity,
} from "@/lib/meta-tracking/daily-collection-plan";
import type { MetaTrackingEntityLevel } from "@/lib/db/schema";

/** Um período de calendário fechado, em dias da timezone da conta. */
export type DayRange = InsightsRange;

/**
 * Meses de história capturados na ativação. Treze, e não doze, para que exista
 * um ano completo de sazonalidade COMPARÁVEL: o mesmo mês do ano anterior
 * inteiro, mais o mês corrente.
 */
export const BACKFILL_MONTHS = 13;

/**
 * Dias por fatia. Um mês é o compromisso entre o número de jobs assíncronos
 * (cada um custa POST + polls + páginas) e o risco de estourar o teto de linhas
 * do relatório no nível de anúncio de uma conta grande — que o recuo por
 * bisseção resolve, mas só depois de gastar a tentativa.
 */
export const DEFAULT_BACKFILL_SLICE_DAYS = 31;

/**
 * Orçamento de chamadas por conta e por invocação (§6 do plano). O backfill roda
 * na mesma madrugada do coletor diário e contra a MESMA cota por conta: sem
 * teto, uma conta grande consumiria a cota inteira e deixaria a coleta do dia —
 * que é irrecuperável — sem chamadas.
 */
export const DEFAULT_MAX_API_CALLS_PER_ACCOUNT = 300;

/** Estado efetivo que a Meta usa para "removido": não entra no baseline. */
const DELETED_EFFECTIVE_STATUS = "DELETED";

/** Ordem de coleta: o pai antes do filho, como no coletor diário. */
const LEVEL_ORDER: readonly MetaTrackingEntityLevel[] = [
  "campaign",
  "adset",
  "ad",
];

function dayIndex(day: DayKey): number {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, dayOfMonth, 12) / 86_400_000;
}

/**
 * O mesmo dia do mês, N meses antes ou depois, com o fim de mês preservado.
 *
 * A aritmética ingênua de `Date` transborda (31 de março menos um mês vira 3 de
 * março, não 28 de fevereiro) e faria o alvo do backfill oscilar de mês em mês.
 */
function shiftMonthsDayKey(day: DayKey, months: number): DayKey {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const firstOfTarget = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  const daysInTarget = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(dayOfMonth, daysInTarget));
  return firstOfTarget.toISOString().slice(0, 10);
}

/**
 * O período que o backfill desta conta persegue.
 *
 * Termina no dia ANTERIOR ao primeiro da janela móvel do coletor diário: tudo
 * que o backfill grava já está congelado (`is_final = true` sai de graça de
 * `toDailyMetricRows`), e nenhuma linha mutável é escrita por dois processos.
 */
export function backfillTargetRange(
  today: DayKey,
  months = BACKFILL_MONTHS,
): DayRange {
  return {
    since: shiftMonthsDayKey(today, -months),
    until: shiftDayKey(today, -(METRICS_MUTABLE_DAYS + 1)),
  };
}

/** Períodos ordenados e fundidos; sobrepostos ou encostados viram um só. */
export function mergeDayRanges(ranges: readonly DayRange[]): DayRange[] {
  const valid = ranges
    .filter((range) => rangeDays(range) > 0)
    .sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));

  const merged: DayRange[] = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    // Encostado (`until` + 1 dia === `since`) conta como contíguo: dois períodos
    // vizinhos são um só, e é isso que faz a retomada convergir para um período.
    if (last && dayIndex(range.since) <= dayIndex(last.until) + 1) {
      if (range.until > last.until) last.until = range.until;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

/** O que do alvo ainda não foi coberto, em ordem cronológica. */
export function subtractDayRanges(
  target: DayRange,
  covered: readonly DayRange[],
): DayRange[] {
  if (rangeDays(target) === 0) return [];

  const remaining: DayRange[] = [];
  let cursor = target.since;

  for (const range of mergeDayRanges(covered)) {
    if (range.until < cursor) continue;
    if (range.since > target.until) break;
    if (range.since > cursor) {
      remaining.push({ since: cursor, until: shiftDayKey(range.since, -1) });
    }
    if (range.until >= target.until) return remaining;
    cursor = shiftDayKey(range.until, 1);
  }

  if (cursor <= target.until) remaining.push({ since: cursor, until: target.until });
  return remaining;
}

/** Fatias de no máximo `maxDays`, do mais recente para o mais antigo. */
export function sliceDayRange(range: DayRange, maxDays: number): DayRange[] {
  const size = Math.max(1, Math.trunc(maxDays));
  const slices: DayRange[] = [];
  let until = range.until;

  while (rangeDays({ since: range.since, until }) > 0) {
    const since = shiftDayKey(until, -(size - 1));
    const clamped = since < range.since ? range.since : since;
    slices.push({ since: clamped, until });
    if (clamped === range.since) break;
    until = shiftDayKey(clamped, -1);
  }

  return slices;
}

export type BackfillAccountProgress = {
  /** Períodos já capturados, fundidos e ordenados. */
  covered: DayRange[];
  /** ISO da conclusão do baseline de configuração; `null` = ainda não rodou. */
  baselineCompletedAt: string | null;
};

export const EMPTY_BACKFILL_PROGRESS: BackfillAccountProgress = {
  covered: [],
  baselineCompletedAt: null,
};

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toDayRange(value: unknown): DayRange | null {
  if (typeof value !== "object" || value === null) return null;
  const { since, until } = value as { since?: unknown; until?: unknown };
  if (typeof since !== "string" || typeof until !== "string") return null;
  if (!DAY_KEY_PATTERN.test(since) || !DAY_KEY_PATTERN.test(until)) return null;
  return { since, until };
}

/**
 * O progresso como ele volta do `summary` do run — jsonb, portanto `unknown`.
 *
 * Tolerante de propósito: o backfill é retomável, e um progresso ilegível deve
 * custar trabalho repetido (que é idempotente), nunca uma exceção que impeça a
 * conta inteira de continuar.
 */
export function parseBackfillProgress(value: unknown): BackfillAccountProgress {
  if (typeof value !== "object" || value === null) return { ...EMPTY_BACKFILL_PROGRESS };

  const record = value as {
    covered?: unknown;
    baselineCompletedAt?: unknown;
  };
  const covered = Array.isArray(record.covered)
    ? record.covered.map(toDayRange).filter((range): range is DayRange => range !== null)
    : [];

  return {
    covered: mergeDayRanges(covered),
    baselineCompletedAt:
      typeof record.baselineCompletedAt === "string"
        ? record.baselineCompletedAt
        : null,
  };
}

/** Funde vários progressos gravados (um por run) num só. */
export function mergeBackfillProgress(
  progresses: readonly BackfillAccountProgress[],
): BackfillAccountProgress {
  const baselines = progresses
    .map((progress) => progress.baselineCompletedAt)
    .filter((value): value is string => value !== null)
    .sort();

  return {
    covered: mergeDayRanges(progresses.flatMap((progress) => progress.covered)),
    baselineCompletedAt: baselines[0] ?? null,
  };
}

/** A fatia terminou: entra no progresso e se funde com o que já havia. */
export function withSliceCovered(
  progress: BackfillAccountProgress,
  slice: DayRange,
): BackfillAccountProgress {
  return {
    covered: mergeDayRanges([...progress.covered, slice]),
    baselineCompletedAt: progress.baselineCompletedAt,
  };
}

export type PlanAccountBackfillInput = {
  /** Hoje na timezone da conta. */
  today: DayKey;
  covered: readonly DayRange[];
  months?: number;
  sliceDays?: number;
  /** Teto de fatias nesta invocação; o resto fica para a próxima noite. */
  maxSlices?: number;
};

export type AccountBackfillPlan = {
  /** As fatias a executar agora, da mais recente para a mais antiga. */
  slices: DayRange[];
  /** Dias do alvo ainda não capturados — incluindo os que não couberam hoje. */
  remainingDays: number;
  /** Dias do alvo inteiro; com `remainingDays` dá o progresso da conta. */
  targetDays: number;
};

export function planAccountBackfill(
  input: PlanAccountBackfillInput,
): AccountBackfillPlan {
  const target = backfillTargetRange(input.today, input.months);
  const pending = subtractDayRanges(target, input.covered);
  const sliceDays = input.sliceDays ?? DEFAULT_BACKFILL_SLICE_DAYS;

  // Do mais recente para o mais antigo, entre períodos e dentro de cada um.
  const slices = [...pending]
    .reverse()
    .flatMap((range) => sliceDayRange(range, sliceDays));

  return {
    slices:
      input.maxSlices !== undefined ? slices.slice(0, Math.max(0, input.maxSlices)) : slices,
    remainingDays: pending.reduce((total, range) => total + rangeDays(range), 0),
    targetDays: rangeDays(target),
  };
}

export type PlanBaselineFetchInput = {
  listing: readonly ListedEntity[];
  chunkSize?: number;
};

/**
 * Os lotes do fetch profundo do baseline: TODAS as entidades da conta, menos as
 * removidas.
 *
 * É o oposto de `planDeepFetch`, e de propósito: o coletor diário só busca quem
 * está entregando, porque configuração de quem não gasta não muda de valor; o
 * baseline busca todo mundo uma vez só, porque é a única foto que existirá do
 * estado em que a conta entrou no tracking.
 */
export function planBaselineFetch(
  input: PlanBaselineFetchInput,
): DeepFetchChunk[] {
  const idsByLevel = new Map<MetaTrackingEntityLevel, string[]>();

  for (const entity of input.listing) {
    if (entity.effectiveStatus === DELETED_EFFECTIVE_STATUS) continue;
    const ids = idsByLevel.get(entity.entityLevel) ?? [];
    ids.push(entity.entityId);
    idsByLevel.set(entity.entityLevel, ids);
  }

  const chunkSize = Math.max(1, input.chunkSize ?? DEEP_FETCH_CHUNK_SIZE);
  const chunks: DeepFetchChunk[] = [];
  for (const entityLevel of LEVEL_ORDER) {
    for (const entityIds of chunkIds(idsByLevel.get(entityLevel) ?? [], chunkSize)) {
      chunks.push({ entityLevel, entityIds });
    }
  }
  return chunks;
}

/**
 * Ainda cabe mais uma fatia no orçamento desta conta?
 *
 * Verificado ANTES de cada fatia, e não depois: o objetivo é não competir com o
 * coletor diário pela cota da conta, e quem já gastou o orçamento para no ponto
 * em que está — o progresso da fatia anterior já está gravado.
 */
export function hasApiCallBudgetLeft(args: {
  apiCallsUsed: number;
  maxApiCalls: number;
}): boolean {
  return args.apiCallsUsed < args.maxApiCalls;
}
