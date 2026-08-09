/**
 * Invólucros de consulta da correlação de tracking (§8 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Aqui só mora I/O: carregar versões, ações e série diária do Postgres e
 * entregá-las ao núcleo puro de `lib/meta-tracking/correlation.ts`, que é quem
 * decide vigência, janelas e flags. Nenhuma regra de correlação é reescrita em
 * SQL — se estivesse nos dois lugares, a metodologia mudaria em um só.
 *
 * Nada aqui materializa nada: a correlação é computada na leitura, sobre os
 * dados brutos, exatamente como a decisão 8 do plano determina.
 */

import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  metaTrackingAccountCoverage,
  metaTrackingChangeEvent,
  metaTrackingConfigVersion,
  metaTrackingDailyMetric,
  type MetaTrackingChangeEvent,
  type MetaTrackingChangeKind,
  type MetaTrackingChangeSource,
  type MetaTrackingConfigVersion,
  type MetaTrackingDailyMetric,
  type MetaTrackingEntityLevel,
} from "@/lib/db/schema";
import {
  buildEntityTimeline,
  computeActionEffect,
  dayKeyOf,
  selectVersionAt,
  shiftDayKey,
  type ActionEffect,
  type DayKey,
  type StateAt,
  type TimelineEntry,
} from "@/lib/meta-tracking/correlation";

/** Janela padrão de `getActionEffect`, em dias de cada lado. */
export const DEFAULT_ACTION_EFFECT_WINDOW_DAYS = 7;

const DEFAULT_ACTION_LIMIT = 100;
const MAX_ACTION_LIMIT = 500;

/**
 * Quantas versões carregar quando a pergunta é por dia de calendário. O dia
 * pedido vira uma faixa de instantes de ~38 h (nenhum fuso passa de ±14 h de
 * UTC) e o núcleo puro escolhe dentro dela; o teto existe só para a consulta
 * não virar um scan da entidade inteira. Uma entidade não ganha dezenas de
 * versões em dois dias — cada uma exige uma mudança real de configuração.
 */
const VERSION_CANDIDATE_LIMIT = 100;

/** Maior deslocamento de fuso existente, usado para folgar as bordas em SQL. */
const MAX_TIME_ZONE_OFFSET_HOURS = 14;

function isDayKey(value: StateAt): value is DayKey {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Instante seguramente posterior ao fim do dia `day` em qualquer fuso — o filtro
 * grosso que a SQL aplica antes de o núcleo puro decidir com exatidão.
 */
function upperBoundOf(day: DayKey): Date {
  const startOfNextDay = new Date(`${shiftDayKey(day, 1)}T00:00:00.000Z`);
  return new Date(
    startOfNextDay.getTime() + MAX_TIME_ZONE_OFFSET_HOURS * 3600_000,
  );
}

/** Instante seguramente anterior ao início do dia `day` em qualquer fuso. */
function lowerBoundOf(day: DayKey): Date {
  return new Date(
    new Date(`${day}T00:00:00.000Z`).getTime() -
      MAX_TIME_ZONE_OFFSET_HOURS * 3600_000,
  );
}

/**
 * A configuração vigente de uma entidade numa data — a consulta de vigência que
 * responde "o que estava valendo quando o resultado mudou?".
 *
 * `at` aceita um instante (vigência meio-aberta) ou um dia `YYYY-MM-DD`, que
 * devolve a configuração com que o dia terminou. Sem versão que cubra a data —
 * antes da primeira coleta, ou depois de a entidade sumir da conta — devolve
 * `null`.
 */
export async function getEntityStateAt(args: {
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  at: StateAt;
  /** Timezone da conta de anúncio; só importa quando `at` é um dia. */
  timeZone?: string;
}): Promise<MetaTrackingConfigVersion | null> {
  const { entityLevel, entityId, at, timeZone } = args;
  const upperBound = isDayKey(at)
    ? upperBoundOf(at)
    : at instanceof Date
      ? at
      : new Date(at);

  const candidates = await db
    .select()
    .from(metaTrackingConfigVersion)
    .where(
      and(
        eq(metaTrackingConfigVersion.entityLevel, entityLevel),
        eq(metaTrackingConfigVersion.entityId, entityId),
        lte(metaTrackingConfigVersion.validFrom, upperBound),
      ),
    )
    .orderBy(desc(metaTrackingConfigVersion.validFrom))
    .limit(VERSION_CANDIDATE_LIMIT);

  return selectVersionAt(candidates, at, timeZone);
}

export type EntityTimeline = {
  /**
   * A configuração que já estava valendo quando o período começou. Ela não é
   * uma entrada da linha do tempo (não aconteceu nele), mas sem ela a leitura
   * começa no escuro.
   */
  stateAtStart: MetaTrackingConfigVersion | null;
  entries: Array<
    TimelineEntry<
      MetaTrackingConfigVersion,
      MetaTrackingChangeEvent,
      MetaTrackingDailyMetric
    >
  >;
};

/**
 * Versões, ações e série diária de uma entidade num período, em ordem
 * cronológica — a história completa de uma campanha num lugar só.
 */
export async function getEntityTimeline(args: {
  entityLevel: MetaTrackingEntityLevel;
  entityId: string;
  from: DayKey;
  to: DayKey;
  timeZone?: string;
}): Promise<EntityTimeline> {
  const { entityLevel, entityId, from, to, timeZone } = args;
  const lower = lowerBoundOf(from);
  const upper = upperBoundOf(to);

  const [stateAtStart, versions, actions, series] = await Promise.all([
    getEntityStateAt({ entityLevel, entityId, at: from, timeZone }),
    db
      .select()
      .from(metaTrackingConfigVersion)
      .where(
        and(
          eq(metaTrackingConfigVersion.entityLevel, entityLevel),
          eq(metaTrackingConfigVersion.entityId, entityId),
          gte(metaTrackingConfigVersion.validFrom, lower),
          lte(metaTrackingConfigVersion.validFrom, upper),
        ),
      )
      .orderBy(asc(metaTrackingConfigVersion.validFrom)),
    db
      .select()
      .from(metaTrackingChangeEvent)
      .where(
        and(
          eq(metaTrackingChangeEvent.entityLevel, entityLevel),
          eq(metaTrackingChangeEvent.entityId, entityId),
          gte(metaTrackingChangeEvent.occurredAt, lower),
          lte(metaTrackingChangeEvent.occurredAt, upper),
        ),
      )
      .orderBy(asc(metaTrackingChangeEvent.occurredAt)),
    db
      .select()
      .from(metaTrackingDailyMetric)
      .where(
        and(
          eq(metaTrackingDailyMetric.entityLevel, entityLevel),
          eq(metaTrackingDailyMetric.entityId, entityId),
          gte(metaTrackingDailyMetric.metricDate, from),
          lte(metaTrackingDailyMetric.metricDate, to),
        ),
      )
      .orderBy(asc(metaTrackingDailyMetric.metricDate)),
  ]);

  return {
    stateAtStart,
    entries: buildEntityTimeline({
      versions,
      actions,
      series,
      range: { from, to },
      timeZone,
    }),
  };
}

/**
 * Escopo dos confundidores: só a própria entidade, ou a campanha inteira —
 * pausar o conjunto irmão ou mexer no orçamento da campanha muda o resultado do
 * anúncio tanto quanto mexer nele.
 */
export type ConcurrentScope = "entity" | "campaign";

/**
 * Timezone da conta de anúncio, que é quem define o "dia" nos insights da Meta.
 * Vem da cobertura mais recente da conta; sem cobertura registrada, UTC.
 */
async function resolveAccountTimeZone(accountId: string): Promise<string> {
  const [row] = await db
    .select({ timezoneName: metaTrackingAccountCoverage.timezoneName })
    .from(metaTrackingAccountCoverage)
    .where(
      and(
        eq(metaTrackingAccountCoverage.accountId, accountId),
        isNotNull(metaTrackingAccountCoverage.timezoneName),
      ),
    )
    .orderBy(desc(metaTrackingAccountCoverage.businessDate))
    .limit(1);

  return row?.timezoneName ?? "UTC";
}

/**
 * Janela de N dias antes e depois de uma ação, com as flags que dizem quando a
 * comparação não é confiável: outra ação na janela (`confounded`), volta à fase
 * de aprendizado (`learningPhaseResetInWindow`), dias faltando
 * (`daysWithData`) e atribuição ainda mutável (`provisional`).
 *
 * Devolve `null` quando o evento não existe.
 */
export async function getActionEffect(args: {
  changeEventId: string;
  windowDays?: number;
  concurrentScope?: ConcurrentScope;
  /** Sobrepõe a timezone da conta (que é o default). */
  timeZone?: string;
}): Promise<ActionEffect | null> {
  const {
    changeEventId,
    windowDays = DEFAULT_ACTION_EFFECT_WINDOW_DAYS,
    concurrentScope = "campaign",
  } = args;

  const [action] = await db
    .select()
    .from(metaTrackingChangeEvent)
    .where(eq(metaTrackingChangeEvent.id, changeEventId))
    .limit(1);

  if (!action) return null;

  const timeZone =
    args.timeZone ?? (await resolveAccountTimeZone(action.accountId));

  const actionDay = dayKeyOf(action.occurredAt, timeZone);
  const windowFrom = shiftDayKey(actionDay, -windowDays);
  const windowTo = shiftDayKey(actionDay, windowDays);
  const lower = lowerBoundOf(windowFrom);
  const upper = upperBoundOf(windowTo);

  const [series, concurrentActions, versions] = await Promise.all([
    db
      .select()
      .from(metaTrackingDailyMetric)
      .where(
        and(
          eq(metaTrackingDailyMetric.entityLevel, action.entityLevel),
          eq(metaTrackingDailyMetric.entityId, action.entityId),
          gte(metaTrackingDailyMetric.metricDate, windowFrom),
          lte(metaTrackingDailyMetric.metricDate, windowTo),
        ),
      ),
    db
      .select()
      .from(metaTrackingChangeEvent)
      .where(
        and(
          eq(metaTrackingChangeEvent.accountId, action.accountId),
          concurrentScopeCondition(action, concurrentScope),
          gte(metaTrackingChangeEvent.occurredAt, lower),
          lte(metaTrackingChangeEvent.occurredAt, upper),
        ),
      ),
    // Versões anteriores à janela também vêm: a transição para "aprendendo" só
    // é reset se houver uma leitura anterior fora do aprendizado.
    db
      .select({
        validFrom: metaTrackingConfigVersion.validFrom,
        learningStageInfo: metaTrackingConfigVersion.learningStageInfo,
      })
      .from(metaTrackingConfigVersion)
      .where(
        and(
          eq(metaTrackingConfigVersion.entityLevel, action.entityLevel),
          eq(metaTrackingConfigVersion.entityId, action.entityId),
          lte(metaTrackingConfigVersion.validFrom, upper),
        ),
      )
      .orderBy(desc(metaTrackingConfigVersion.validFrom))
      .limit(VERSION_CANDIDATE_LIMIT),
  ]);

  return computeActionEffect({
    action,
    series,
    windowDays,
    timeZone,
    concurrentActions,
    learningObservations: versions.map((version) => ({
      at: version.validFrom,
      learningStageInfo: version.learningStageInfo,
    })),
  });
}

/**
 * Entidades cujas ações disputam a explicação do resultado. No escopo de
 * campanha entram a própria entidade, seus ancestrais (pelos ids
 * desnormalizados) e tudo que pende da mesma campanha.
 */
function concurrentScopeCondition(
  action: Pick<
    MetaTrackingChangeEvent,
    "entityLevel" | "entityId" | "campaignId" | "adsetId"
  >,
  scope: ConcurrentScope,
): SQL | undefined {
  const sameEntity = and(
    eq(metaTrackingChangeEvent.entityLevel, action.entityLevel),
    eq(metaTrackingChangeEvent.entityId, action.entityId),
  );

  if (scope === "entity") return sameEntity;

  // O nível da própria entidade guarda `campaign_id`/`adset_id` nulos, então a
  // campanha da ação pode ser ela mesma.
  const campaignId =
    action.campaignId ??
    (action.entityLevel === "campaign" ? action.entityId : null);
  const relatedIds = [action.entityId, action.campaignId, action.adsetId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  return or(
    sameEntity,
    inArray(metaTrackingChangeEvent.entityId, relatedIds),
    ...(campaignId ? [eq(metaTrackingChangeEvent.campaignId, campaignId)] : []),
  );
}

export type FindActionsFilters = {
  userId?: string;
  accountId?: string;
  entityLevel?: MetaTrackingEntityLevel;
  entityId?: string;
  campaignId?: string;
  adsetId?: string;
  /** Qualquer um destes campos aparece no diff pré-computado. */
  changedFields?: readonly string[];
  changeKind?: MetaTrackingChangeKind | readonly MetaTrackingChangeKind[];
  source?: MetaTrackingChangeSource | readonly MetaTrackingChangeSource[];
  /** Período por `occurred_at`, inclusivo. */
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
};

/**
 * Busca no stream unificado de ações — "quem mexeu em orçamento neste mês, e
 * por quê".
 *
 * O filtro por campo alterado interroga o diff que a coleta já pré-computou
 * (`changed_fields`), nunca compara configurações em tempo de consulta: é essa
 * pré-computação que torna a pergunta barata.
 *
 * `jsonb_exists_any` é a forma funcional do operador `?|`. Preferida porque o
 * `?` literal é ambíguo para drivers que o usam como placeholder — e este
 * projeto tem dois clientes falando com o mesmo banco.
 */
export async function findActions(
  filters: FindActionsFilters = {},
): Promise<MetaTrackingChangeEvent[]> {
  const conditions: SQL[] = [];

  if (filters.userId) {
    conditions.push(eq(metaTrackingChangeEvent.userId, filters.userId));
  }
  if (filters.accountId) {
    conditions.push(eq(metaTrackingChangeEvent.accountId, filters.accountId));
  }
  if (filters.entityLevel) {
    conditions.push(
      eq(metaTrackingChangeEvent.entityLevel, filters.entityLevel),
    );
  }
  if (filters.entityId) {
    conditions.push(eq(metaTrackingChangeEvent.entityId, filters.entityId));
  }
  if (filters.campaignId) {
    conditions.push(eq(metaTrackingChangeEvent.campaignId, filters.campaignId));
  }
  if (filters.adsetId) {
    conditions.push(eq(metaTrackingChangeEvent.adsetId, filters.adsetId));
  }
  if (filters.changedFields && filters.changedFields.length > 0) {
    const keys = filters.changedFields.map((field) => sql`${field}`);
    conditions.push(
      sql`jsonb_exists_any(${metaTrackingChangeEvent.changedFields}, ARRAY[${sql.join(keys, sql`, `)}]::text[])`,
    );
  }
  if (filters.changeKind) {
    const kinds = Array.isArray(filters.changeKind)
      ? filters.changeKind
      : [filters.changeKind];
    conditions.push(inArray(metaTrackingChangeEvent.changeKind, [...kinds]));
  }
  if (filters.source) {
    const sources = Array.isArray(filters.source)
      ? filters.source
      : [filters.source];
    conditions.push(inArray(metaTrackingChangeEvent.source, [...sources]));
  }
  if (filters.from) {
    conditions.push(gte(metaTrackingChangeEvent.occurredAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(metaTrackingChangeEvent.occurredAt, filters.to));
  }

  const limit = Math.min(
    Math.max(filters.limit ?? DEFAULT_ACTION_LIMIT, 1),
    MAX_ACTION_LIMIT,
  );

  return db
    .select()
    .from(metaTrackingChangeEvent)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    // O id desempata para a paginação não repetir nem pular ações simultâneas.
    .orderBy(desc(metaTrackingChangeEvent.occurredAt), desc(metaTrackingChangeEvent.id))
    .limit(limit)
    .offset(Math.max(filters.offset ?? 0, 0));
}
