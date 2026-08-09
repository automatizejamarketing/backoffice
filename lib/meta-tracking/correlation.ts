/**
 * Correlação ação → resultado, computada na LEITURA (§8 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Este arquivo é o núcleo puro: recebe séries diárias, versões de configuração e
 * eventos de mudança já carregados e devolve estado-na-data, linha do tempo e
 * janelas antes/depois com as flags que dizem quando a janela NÃO é confiável.
 * Nada de I/O — os invólucros que falam com o banco vivem em
 * `lib/db/meta-tracking-correlation-queries.ts`.
 *
 * A separação existe porque a metodologia de correlação ainda vai mudar muito
 * (a v1 não materializa nada): mantendo o cálculo puro, mudar a metodologia é
 * mudar uma função testada com séries sintéticas, não uma consulta SQL.
 *
 * Convenções que valem para o arquivo inteiro:
 *
 * - **Dia** é `YYYY-MM-DD` na timezone da conta de anúncio, exatamente como a
 *   Meta reporta e como `meta_tracking_daily_metrics.metric_date` guarda. Toda
 *   aritmética de janela é feita sobre essas strings; instantes (`occurred_at`,
 *   `valid_from`) são convertidos para dia com a timezone da conta.
 * - **Vigência** é meio-aberta `[valid_from, valid_to)`: no instante exato da
 *   mudança já vale a versão nova.
 * - **Dinheiro** dos insights (`spend`, `action_values`) vem em unidades
 *   MAIORES; os orçamentos das versões vêm em unidades menores. Este módulo só
 *   soma valores de insights — nunca misture as duas escalas.
 */

import type {
  MetaTrackingChangedFields,
  MetaTrackingChangeKind,
  MetaTrackingChangeSource,
  MetaTrackingEntityLevel,
} from "@/lib/db/schema";

/** `YYYY-MM-DD`. */
export type DayKey = string;

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Só o que a regra de vigência precisa. As linhas de
 * `meta_tracking_config_versions` satisfazem isto estruturalmente, e um teste
 * consegue montar uma versão em quatro campos.
 */
export type VersionVigencia = {
  id: string;
  versionNumber: number;
  validFrom: Date;
  validTo: Date | null;
};

/** Instante ou dia de calendário. Um dia resolve o estado do FIM daquele dia. */
export type StateAt = Date | string;

/** `YYYY-MM-DD` de um instante na timezone informada (default UTC). */
export function dayKeyOf(instant: Date, timeZone = "UTC"): DayKey {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * A timezone é reconhecida pelo runtime? Vale para valor vindo de dado (o
 * `timezone_name` que a Meta devolveu e a coleta gravou), não para constante
 * escrita à mão: `dayKeyOf` estoura com fuso desconhecido, e uma consulta de
 * leitura não pode morrer porque uma conta veio com um nome estranho.
 */
export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Desloca um dia de calendário (meio-dia UTC evita as bordas de horário de verão). */
export function shiftDayKey(day: DayKey, days: number): DayKey {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, dayOfMonth, 12));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return dayKeyOf(shifted);
}

/** O valor é um dia de calendário, e não um instante? */
export function isDayKey(value: unknown): value is DayKey {
  return typeof value === "string" && DAY_KEY_PATTERN.test(value);
}

function toInstant(value: Date | string): Date {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new TypeError(`Data inválida para correlação: ${String(value)}`);
  }
  return instant;
}

/**
 * A versão vigente em `at` — o "estado da entidade em qualquer data".
 *
 * Com um instante, a vigência é meio-aberta `[valid_from, valid_to)`: no
 * segundo exato da mudança já vale a versão nova. Com um dia de calendário
 * (`YYYY-MM-DD`), devolve a configuração com que o dia TERMINOU — é ela que
 * responde por aquela linha da série diária, e é por isso que o dia da mudança
 * pertence à versão nova.
 *
 * Devolve `null` antes da primeira versão e depois de uma última versão já
 * fechada (entidade que sumiu da conta). Versões podem vir em qualquer ordem.
 */
export function selectVersionAt<V extends VersionVigencia>(
  versions: readonly V[],
  at: StateAt,
  timeZone = "UTC",
): V | null {
  if (versions.length === 0) return null;

  const day = isDayKey(at) ? at : null;
  const instant = day === null ? toInstant(at) : null;

  let current: V | null = null;
  for (const version of versions) {
    const covers = day
      ? dayKeyOf(version.validFrom, timeZone) <= day &&
        (version.validTo === null ||
          dayKeyOf(version.validTo, timeZone) > day)
      : version.validFrom.getTime() <= instant!.getTime() &&
        (version.validTo === null ||
          version.validTo.getTime() > instant!.getTime());

    if (!covers) continue;
    // Duas versões abertas para a mesma entidade é bug do coletor, não caso de
    // uso — mas a leitura não pode ficar não-determinística por causa disso.
    if (
      current === null ||
      version.validFrom.getTime() > current.validFrom.getTime() ||
      (version.validFrom.getTime() === current.validFrom.getTime() &&
        version.versionNumber > current.versionNumber)
    ) {
      current = version;
    }
  }

  return current;
}

/**
 * Entrada da linha do tempo unificada. Carrega a linha original inteira
 * (`version` / `action` / `metrics`) porque quem lê história quase sempre quer
 * o detalhe logo em seguida.
 */
export type TimelineEntry<V, A, M> =
  | { kind: "version"; day: DayKey; at: Date; version: V }
  | { kind: "action"; day: DayKey; at: Date; action: A }
  /** O dia inteiro, não um instante — daí `at: null`. */
  | { kind: "metrics"; day: DayKey; at: null; metrics: M };

/**
 * Um dia da série (`meta_tracking_daily_metrics`). Os tipos aceitos são os que o
 * Drizzle devolve: `numeric` vira string, JSONB vira `unknown`. Uma linha do
 * banco satisfaz isto sem adaptação, e um teste monta um dia em duas chaves.
 */
export type DailyMetricPoint = {
  metricDate: DayKey;
  spend?: string | number | null;
  impressions?: string | number | null;
  clicks?: string | number | null;
  /** Famílias cruas da Meta: `[{ action_type, value }]`. */
  actions?: unknown;
  actionValues?: unknown;
  purchaseRoas?: unknown;
  websitePurchaseRoas?: unknown;
  /** `false` = ainda dentro da janela de 28 dias em que a atribuição muda. */
  isFinal?: boolean | null;
};

/**
 * A ação sob análise. Linhas de `meta_tracking_change_events` satisfazem isto
 * estruturalmente.
 */
export type CorrelationAction = {
  id: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  occurredAt: Date;
  changeKind?: MetaTrackingChangeKind;
  changedFields?: MetaTrackingChangedFields | null;
  source?: MetaTrackingChangeSource | null;
  entityName?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  actorEmail?: string | null;
  note?: string | null;
};

/**
 * Resultado agregado de um lado da janela.
 *
 * `reach` e `frequency` não aparecem de propósito: são métricas de pessoas
 * únicas e somá-las por dia produz um número que não significa nada. Quem
 * precisar delas tem de pedir à Meta a janela inteira de uma vez.
 */
export type WindowAggregate = {
  from: DayKey;
  to: DayKey;
  /** Dias de calendário pedidos. */
  daysRequested: number;
  /** Dias que existem de fato na série — a diferença é buraco de cobertura. */
  daysWithData: number;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  /** `purchaseValue / spend`; `null` sem gasto. */
  roas: number | null;
  spendPerDay: number | null;
  impressionsPerDay: number | null;
  clicksPerDay: number | null;
  purchasesPerDay: number | null;
  purchaseValuePerDay: number | null;
  /** Algum dia da janela ainda pode mudar de valor (atribuição retroativa). */
  provisional: boolean;
};

export type PerDayDelta = {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  /** Diferença de ROAS; `null` se algum dos lados não teve gasto. */
  roas: number | null;
};

/**
 * Prioridade de leitura das compras. A Meta devolve `purchase` e
 * `omni_purchase` na mesma resposta contando o mesmo fato: somar os dois dobra
 * o número. Mesma lista de `lib/meta-business/transformers.ts`.
 */
const PURCHASE_ACTION_TYPES = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
] as const;

const ROAS_ACTION_TYPES = ["omni_purchase", "purchase"] as const;

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Primeiro `action_type` da lista de prioridade presente na família. */
function actionFamilyValue(
  family: unknown,
  actionTypes: readonly string[],
): number {
  if (!Array.isArray(family)) return 0;
  for (const actionType of actionTypes) {
    const hit = family.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { action_type?: unknown }).action_type === actionType,
    );
    if (hit) return toNumber((hit as { value?: unknown }).value);
  }
  return 0;
}

function ratePerDay(total: number, days: number): number | null {
  return days > 0 ? total / days : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `learning_stage_info` da Meta: `{ status, last_sig_edit_ts, conversions… }`.
 * O carimbo vem em segundos desde a época; o resto é opaco.
 */
function readLearningStage(info: unknown): {
  status: string | null;
  lastSignificantEditAt: Date | null;
} {
  if (!isRecord(info)) return { status: null, lastSignificantEditAt: null };

  const rawStatus = info.status;
  const status =
    typeof rawStatus === "string" ? rawStatus.toUpperCase() : null;

  const rawEdit = info.last_sig_edit_ts;
  let lastSignificantEditAt: Date | null = null;
  if (typeof rawEdit === "number" || typeof rawEdit === "string") {
    const seconds = Number(rawEdit);
    if (Number.isFinite(seconds) && seconds > 0) {
      lastSignificantEditAt = new Date(seconds * 1000);
    }
  }

  return { status, lastSignificantEditAt };
}

/** `LEARNING` e `LEARNING_LIMITED` — as duas são fase de aprendizado. */
function isLearning(status: string | null): boolean {
  return status !== null && status.startsWith("LEARNING");
}

/**
 * Soma os dias da série que caem em `[from, to]`, inclusive dos dois lados.
 *
 * Dias ausentes simplesmente não entram — a janela nunca "anda" para trás para
 * completar a contagem, porque esticá-la compararia períodos diferentes sem
 * avisar. `daysWithData` é o que denuncia o buraco. Um dia presente conta mesmo
 * com tudo zerado: houve coleta, a entrega é que foi zero.
 */
function aggregateWindow(
  series: readonly DailyMetricPoint[],
  from: DayKey,
  to: DayKey,
  daysRequested: number,
): WindowAggregate {
  const daysSeen = new Set<DayKey>();
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let purchases = 0;
  let purchaseValue = 0;
  let provisional = false;

  for (const point of series) {
    if (point.metricDate < from || point.metricDate > to) continue;

    daysSeen.add(point.metricDate);
    const daySpend = toNumber(point.spend);
    spend += daySpend;
    impressions += toNumber(point.impressions);
    clicks += toNumber(point.clicks);
    purchases += actionFamilyValue(point.actions, PURCHASE_ACTION_TYPES);

    let dayValue = actionFamilyValue(point.actionValues, PURCHASE_ACTION_TYPES);
    if (dayValue <= 0 && daySpend > 0) {
      // Contas sem `action_values` ainda reportam ROAS; sem esta volta o valor
      // de compra cairia para zero em silêncio.
      const roas =
        actionFamilyValue(point.purchaseRoas, ROAS_ACTION_TYPES) ||
        actionFamilyValue(point.websitePurchaseRoas, ROAS_ACTION_TYPES);
      if (roas > 0) dayValue = roas * daySpend;
    }
    purchaseValue += dayValue;

    if (point.isFinal === false) provisional = true;
  }

  const daysWithData = daysSeen.size;

  return {
    from,
    to,
    daysRequested,
    daysWithData,
    spend,
    impressions,
    clicks,
    purchases,
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : null,
    spendPerDay: ratePerDay(spend, daysWithData),
    impressionsPerDay: ratePerDay(impressions, daysWithData),
    clicksPerDay: ratePerDay(clicks, daysWithData),
    purchasesPerDay: ratePerDay(purchases, daysWithData),
    purchaseValuePerDay: ratePerDay(purchaseValue, daysWithData),
    provisional,
  };
}

/**
 * Uma leitura de `learning_stage_info` num instante. Campo volátil: ele vive na
 * versão de configuração mas fica FORA do hash, então as observações que
 * existem são as das versões que nasceram por outro motivo — a série é
 * esparsa por natureza, e é por isso que a ausência de sinal nunca vira
 * "não houve reset", só "não há evidência".
 */
export type LearningStageObservation = {
  at: Date;
  learningStageInfo?: unknown;
};

export type LearningPhaseResetSource =
  | "status_transition"
  | "last_significant_edit";

/** Ação de terceiro que caiu na mesma janela e disputa a explicação. */
export type ConcurrentAction = {
  id: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  entityName: string | null;
  occurredAt: Date;
  day: DayKey;
  changeKind: MetaTrackingChangeKind | null;
  changedFields: MetaTrackingChangedFields | null;
  source: MetaTrackingChangeSource | null;
  /** `false` = a ação foi em outra entidade (pai, filha ou irmã). */
  sameEntity: boolean;
};

export type ActionEffectInput = {
  action: CorrelationAction;
  /**
   * Série diária da entidade sob análise. Passar a série de várias entidades
   * agrega todas — útil para ver a campanha inteira, errado para comparar uma
   * entidade com ela mesma.
   */
  series: readonly DailyMetricPoint[];
  /** Dias de cada lado. */
  windowDays: number;
  /**
   * Candidatas a confundidor. Quem chama decide o escopo (só a entidade, a
   * campanha inteira, a conta); aqui elas são filtradas pela janela. A própria
   * ação analisada pode vir na lista — ela é descartada pelo id.
   */
  concurrentActions?: readonly CorrelationAction[];
  /** Leituras de fase de aprendizado, tipicamente vindas das versões. */
  learningObservations?: readonly LearningStageObservation[];
  /** Timezone da conta de anúncio, que é quem define o "dia" da Meta. */
  timeZone?: string;
};

export type ActionEffect = {
  actionId: string;
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  occurredAt: Date;
  /** Dia de calendário em que a ação caiu, na timezone da conta. */
  actionDay: DayKey;
  windowDays: number;
  before: WindowAggregate;
  after: WindowAggregate;
  /**
   * O dia da ação, à parte: ele é partido pela própria ação (parte com a
   * configuração velha, parte com a nova) e não pertence a nenhum dos lados.
   */
  actionDayMetrics: WindowAggregate | null;
  /** Os dois lados têm ao menos um dia com dado. */
  hasBothSides: boolean;
  /** Depois − antes, por dia. `null` quando falta um dos lados. */
  deltaPerDay: PerDayDelta | null;
  /** Outra ação caiu na janela: o resultado tem mais de uma causa possível. */
  confounded: boolean;
  concurrentActions: ConcurrentAction[];
  /**
   * A entidade voltou para a fase de aprendizado dentro da janela. Enquanto ela
   * aprende, a entrega é instável por decisão da Meta — o "depois" mede o
   * aprendizado, não a mudança.
   */
  learningPhaseResetInWindow: boolean;
  learningPhaseResetAt: Date | null;
  learningPhaseResetSource: LearningPhaseResetSource | null;
  /** Aprendizado ativo em algum momento da janela, com ou sem reset. */
  learningPhaseActiveInWindow: boolean;
};

/**
 * Janela de N dias antes e depois de uma ação.
 *
 * O dia da ação fica FORA dos dois lados por construção: a mudança aconteceu no
 * meio dele, então aquele dia mistura as duas configurações. Ele volta em
 * `actionDayMetrics` para quem quiser olhar.
 *
 * As somas dos dois lados só são comparáveis quando `daysWithData` bate; quando
 * não bate (buraco de cobertura, ação perto da ponta da série), quem compara é
 * `deltaPerDay`, que normaliza por dia.
 */
export function computeActionEffect(input: ActionEffectInput): ActionEffect {
  const { action, series, windowDays, timeZone = "UTC" } = input;
  assertWindowDays(windowDays);

  const actionDay = dayKeyOf(action.occurredAt, timeZone);
  const windowFrom = shiftDayKey(actionDay, -windowDays);
  const windowTo = shiftDayKey(actionDay, windowDays);

  const before = aggregateWindow(
    series,
    windowFrom,
    shiftDayKey(actionDay, -1),
    windowDays,
  );
  const after = aggregateWindow(
    series,
    shiftDayKey(actionDay, 1),
    windowTo,
    windowDays,
  );
  const actionDayWindow = aggregateWindow(series, actionDay, actionDay, 1);
  const hasBothSides = before.daysWithData > 0 && after.daysWithData > 0;

  // A janela de confundidores inclui o dia da ação: duas mudanças no mesmo dia
  // são o caso mais confuso que existe, não o menos.
  const inWindow = (instant: Date) => {
    const day = dayKeyOf(instant, timeZone);
    return day >= windowFrom && day <= windowTo;
  };

  const concurrentActions = (input.concurrentActions ?? [])
    .filter(
      (candidate) =>
        candidate.id !== action.id && inWindow(candidate.occurredAt),
    )
    .map<ConcurrentAction>((candidate) => ({
      id: candidate.id,
      entityLevel: candidate.entityLevel,
      entityId: candidate.entityId,
      entityName: candidate.entityName ?? null,
      occurredAt: candidate.occurredAt,
      day: dayKeyOf(candidate.occurredAt, timeZone),
      changeKind: candidate.changeKind ?? null,
      changedFields: candidate.changedFields ?? null,
      source: candidate.source ?? null,
      sameEntity:
        candidate.entityLevel === action.entityLevel &&
        candidate.entityId === action.entityId,
    }))
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.id.localeCompare(b.id),
    );

  const learning = detectLearningPhaseReset(
    input.learningObservations ?? [],
    inWindow,
  );

  return {
    actionId: action.id,
    entityLevel: action.entityLevel,
    entityId: action.entityId,
    occurredAt: action.occurredAt,
    actionDay,
    windowDays,
    before,
    after,
    actionDayMetrics: actionDayWindow.daysWithData > 0 ? actionDayWindow : null,
    hasBothSides,
    deltaPerDay: hasBothSides
      ? {
          spend: (after.spendPerDay ?? 0) - (before.spendPerDay ?? 0),
          impressions:
            (after.impressionsPerDay ?? 0) - (before.impressionsPerDay ?? 0),
          clicks: (after.clicksPerDay ?? 0) - (before.clicksPerDay ?? 0),
          purchases:
            (after.purchasesPerDay ?? 0) - (before.purchasesPerDay ?? 0),
          purchaseValue:
            (after.purchaseValuePerDay ?? 0) - (before.purchaseValuePerDay ?? 0),
          roas:
            after.roas === null || before.roas === null
              ? null
              : after.roas - before.roas,
        }
      : null,
    confounded: concurrentActions.length > 0,
    concurrentActions,
    learningPhaseResetInWindow: learning.at !== null,
    learningPhaseResetAt: learning.at,
    learningPhaseResetSource: learning.source,
    learningPhaseActiveInWindow: learning.activeInWindow,
  };
}

/**
 * Vale para o invólucro de banco também: sem isso, um `windowDays` inválido
 * viraria uma faixa de datas sem sentido e três consultas jogadas fora antes de
 * o cálculo reclamar.
 */
export function assertWindowDays(windowDays: number): void {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new RangeError(
      `windowDays precisa ser um inteiro maior que zero (recebido: ${String(windowDays)})`,
    );
  }
}

export type TimelineRange = { from?: DayKey; to?: DayKey };

export type EntityTimelineInput<V, A, M> = {
  versions: readonly V[];
  actions: readonly A[];
  series: readonly M[];
  /** Dias de calendário, inclusivos nas duas pontas. */
  range?: TimelineRange;
  timeZone?: string;
};

/** Versão abre o dia, ação vem no meio, resultado do dia fecha. */
const TIMELINE_RANK = { version: 0, action: 1, metrics: 2 } as const;

/**
 * Versões, ações e série diária de uma entidade numa única sequência
 * cronológica — a leitura de "a história desta campanha" num lugar só.
 *
 * Só entram eventos que caem DENTRO do range. A configuração que já estava
 * valendo quando o range começou não aparece aqui: quem precisa dela chama
 * `selectVersionAt` com o início do range (é o que o invólucro de banco faz).
 */
export function buildEntityTimeline<
  V extends VersionVigencia = VersionVigencia,
  A extends CorrelationAction = CorrelationAction,
  M extends DailyMetricPoint = DailyMetricPoint,
>(input: EntityTimelineInput<V, A, M>): Array<TimelineEntry<V, A, M>> {
  const { versions, actions, series, range, timeZone = "UTC" } = input;
  const withinRange = (day: DayKey) =>
    (range?.from === undefined || day >= range.from) &&
    (range?.to === undefined || day <= range.to);

  const entries: Array<TimelineEntry<V, A, M>> = [];

  for (const version of versions) {
    const day = dayKeyOf(version.validFrom, timeZone);
    if (withinRange(day)) {
      entries.push({ kind: "version", day, at: version.validFrom, version });
    }
  }

  for (const action of actions) {
    const day = dayKeyOf(action.occurredAt, timeZone);
    if (withinRange(day)) {
      entries.push({ kind: "action", day, at: action.occurredAt, action });
    }
  }

  for (const metrics of series) {
    if (withinRange(metrics.metricDate)) {
      entries.push({
        kind: "metrics",
        day: metrics.metricDate,
        at: null,
        metrics,
      });
    }
  }

  return entries.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    const rank = TIMELINE_RANK[a.kind] - TIMELINE_RANK[b.kind];
    if (rank !== 0) return rank;
    return (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0);
  });
}

/**
 * Reset de fase de aprendizado dentro da janela, por dois sinais independentes:
 *
 * 1. `last_sig_edit_ts` — a própria Meta carimba quando uma edição
 *    significativa reiniciou o aprendizado. É o sinal preciso, quando existe.
 * 2. Transição de estado — uma leitura em aprendizado logo depois de uma
 *    leitura fora dele. Só conta com leitura anterior: entidade que nasce
 *    aprendendo está estreando, não reiniciando.
 *
 * Vence o reset mais antigo dentro da janela; empate vai para o carimbo da
 * Meta, que é o mais preciso.
 */
function detectLearningPhaseReset(
  observations: readonly LearningStageObservation[],
  inWindow: (instant: Date) => boolean,
): {
  at: Date | null;
  source: LearningPhaseResetSource | null;
  activeInWindow: boolean;
} {
  const readings = observations
    .map((observation) => ({
      at: observation.at,
      ...readLearningStage(observation.learningStageInfo),
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  let activeInWindow = false;
  const candidates: Array<{ at: Date; source: LearningPhaseResetSource }> = [];

  readings.forEach((reading, index) => {
    const learningNow = isLearning(reading.status);
    if (learningNow && inWindow(reading.at)) activeInWindow = true;

    if (
      reading.lastSignificantEditAt &&
      inWindow(reading.lastSignificantEditAt)
    ) {
      candidates.push({
        at: reading.lastSignificantEditAt,
        source: "last_significant_edit",
      });
    }

    const previous = readings[index - 1];
    if (
      learningNow &&
      inWindow(reading.at) &&
      previous &&
      !isLearning(previous.status)
    ) {
      candidates.push({ at: reading.at, source: "status_transition" });
    }
  });

  candidates.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      (a.source === "last_significant_edit" ? -1 : 1),
  );

  const winner = candidates[0] ?? null;
  return {
    at: winner?.at ?? null,
    source: winner?.source ?? null,
    activeInWindow,
  };
}
