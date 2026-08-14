/**
 * Execução em Postgres do coletor diário (§5.7 e §4.5 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Só I/O: runs, cobertura conta×dia, leitura do estado anterior e gravação do
 * delta. Nenhuma decisão mora aqui — quem decide o que persistir é a costura
 * pura (`lib/meta-tracking/compute-tracking-delta.ts`) e quem decide a ordem é
 * o orquestrador (`lib/meta-tracking/run-daily-collection.ts`).
 *
 * ## O invariante que este arquivo carrega
 *
 * "Uma entidade tem no máximo uma versão aberta." O banco NÃO garante isso — o
 * índice da versão vigente é comum, não único (aviso 2 do ticket 01) —, então
 * fechar a versão antiga e abrir a nova acontece na MESMA transação, junto com
 * os eventos que apontam para elas. Uma conta inteira é uma transação: ou o dia
 * dela entra completo, ou não entra.
 */

import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  metaTrackingAccountCoverage,
  metaTrackingChangeEvent,
  metaTrackingConfigVersion,
  metaTrackingRun,
  type MetaTrackingCoverageStatus,
  type MetaTrackingRunKind,
  type MetaTrackingRunStatus,
  type MetaTrackingRunTriggeredBy,
} from "@/lib/db/schema";
import {
  buildTrackedEntityStates,
  type TrackedEntityState,
} from "@/lib/meta-tracking/daily-collection-plan";
import type {
  RecentInternalChange,
  TrackingDelta,
} from "@/lib/meta-tracking/compute-tracking-delta";
import type { MetaTrackingChangedFields } from "@/lib/db/schema";
import type { DayKey } from "@/lib/meta-tracking/correlation";
import type {
  AccountCoverageRecord,
  PersistDeltaResult,
} from "@/lib/meta-tracking/run-daily-collection";

/**
 * Run parado em `running` além disso foi morto pela plataforma no meio. Igual
 * ao padrão já em produção nos jobs de negócio: um pouco acima do
 * `maxDuration` (300 s) da rota de cron, para que o disparo seguinte recupere o
 * anterior sem esperar meia hora.
 */
const STUCK_RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Runs travados viram `failed` antes de um run novo do mesmo tipo nascer. */
export async function markStuckTrackingRunsFailed(
  kind: MetaTrackingRunKind = "daily",
): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_RUN_TIMEOUT_MS);
  const updated = await db
    .update(metaTrackingRun)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: `Timed out: still running after ${STUCK_RUN_TIMEOUT_MS / 60000} minutes`,
    })
    .where(
      and(
        eq(metaTrackingRun.status, "running"),
        eq(metaTrackingRun.kind, kind),
        lt(metaTrackingRun.startedAt, cutoff),
      ),
    )
    .returning({ id: metaTrackingRun.id });

  return updated.length;
}

export async function createTrackingRun(args: {
  triggeredBy: MetaTrackingRunTriggeredBy;
  kind?: MetaTrackingRunKind;
}): Promise<string> {
  const kind = args.kind ?? "daily";
  await markStuckTrackingRunsFailed(kind);

  const [row] = await db
    .insert(metaTrackingRun)
    .values({ kind, triggeredBy: args.triggeredBy, status: "running" })
    .returning({ id: metaTrackingRun.id });

  if (!row) throw new Error("Failed to create meta tracking run");
  return row.id;
}

export async function finishTrackingRun(args: {
  runId: string;
  status: MetaTrackingRunStatus;
  summary: Record<string, number>;
  errorMessage: string | null;
}): Promise<void> {
  await db
    .update(metaTrackingRun)
    .set({
      status: args.status,
      completedAt: new Date(),
      summary: args.summary,
      errorMessage: args.errorMessage,
    })
    .where(eq(metaTrackingRun.id, args.runId));
}

/**
 * O claim do cron: a cobertura do dia desta conta, se já existir. É o que faz
 * vários disparos na mesma madrugada drenarem a base em vez de refazer o que já
 * foi feito.
 */
export async function getAccountCoverageStatus(args: {
  accountId: string;
  businessDate: DayKey;
}): Promise<MetaTrackingCoverageStatus | null> {
  const [row] = await db
    .select({ status: metaTrackingAccountCoverage.status })
    .from(metaTrackingAccountCoverage)
    .where(
      and(
        eq(metaTrackingAccountCoverage.accountId, args.accountId),
        eq(metaTrackingAccountCoverage.businessDate, args.businessDate),
      ),
    )
    .limit(1);

  return row?.status ?? null;
}

/** Upsert pela unicidade `(account_id, business_date)`: um dia, uma linha. */
export async function upsertAccountCoverage(
  record: AccountCoverageRecord,
): Promise<void> {
  await db
    .insert(metaTrackingAccountCoverage)
    .values({
      runId: record.runId,
      userId: record.userId,
      accountId: record.accountId,
      businessDate: record.businessDate,
      status: record.status,
      errorMessage: record.errorMessage,
      entitiesSeen: record.entitiesSeen,
      apiCallsUsed: record.apiCallsUsed,
      currency: record.currency,
      timezoneName: record.timezoneName,
      completedAt: record.completedAt,
    })
    .onConflictDoUpdate({
      target: [
        metaTrackingAccountCoverage.accountId,
        metaTrackingAccountCoverage.businessDate,
      ],
      set: {
        runId: record.runId,
        userId: record.userId,
        status: record.status,
        errorMessage: record.errorMessage,
        entitiesSeen: record.entitiesSeen,
        apiCallsUsed: record.apiCallsUsed,
        currency: record.currency,
        timezoneName: record.timezoneName,
        completedAt: record.completedAt,
      },
    });
}

/**
 * Contas que este usuário já teve coletadas alguma vez. É como a coleta marca
 * cobertura de quem perdeu o token: sem chamar a Meta não há como listar as
 * contas, e a conta não pode sumir da tela de operação justo no dia em que
 * parou de ser coletada.
 */
export async function listKnownTrackedAccountIds(
  userId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ accountId: metaTrackingAccountCoverage.accountId })
    .from(metaTrackingAccountCoverage)
    .where(eq(metaTrackingAccountCoverage.userId, userId));

  return rows.map((row) => row.accountId);
}

/**
 * Contas já vistas + a timezone da cobertura mais recente de cada uma. É o que
 * o pré-cheque do coletor usa para responder "este usuário já está coberto
 * hoje?" sem gastar descoberta na Meta (a timezone define o "hoje" da conta).
 */
export async function listKnownTrackedAccountsForPrecheck(
  userId: string,
): Promise<Array<{ accountId: string; timezoneName: string | null }>> {
  return db
    .selectDistinctOn([metaTrackingAccountCoverage.accountId], {
      accountId: metaTrackingAccountCoverage.accountId,
      timezoneName: metaTrackingAccountCoverage.timezoneName,
    })
    .from(metaTrackingAccountCoverage)
    .where(eq(metaTrackingAccountCoverage.userId, userId))
    .orderBy(
      metaTrackingAccountCoverage.accountId,
      desc(metaTrackingAccountCoverage.businessDate),
    );
}

/**
 * O estado anterior da conta: versões vigentes + a última transição de estado
 * efetivo de cada entidade.
 *
 * As duas consultas existem porque as duas fontes existem: quem já teve fetch
 * profundo tem versão; quem nunca esteve ativo só aparece no stream de ações. A
 * conciliação (qual das duas é mais recente) é decisão pura e mora em
 * `buildTrackedEntityStates`.
 */
export async function loadAccountTrackedState(args: {
  userId: string;
  accountId: string;
}): Promise<TrackedEntityState[]> {
  const versions = await db
    .select({
      id: metaTrackingConfigVersion.id,
      entityLevel: metaTrackingConfigVersion.entityLevel,
      entityId: metaTrackingConfigVersion.entityId,
      versionNumber: metaTrackingConfigVersion.versionNumber,
      configHash: metaTrackingConfigVersion.configHash,
      isManaged: metaTrackingConfigVersion.isManaged,
      config: metaTrackingConfigVersion.config,
      effectiveStatus: metaTrackingConfigVersion.effectiveStatus,
      lastConfirmedAt: metaTrackingConfigVersion.lastConfirmedAt,
    })
    .from(metaTrackingConfigVersion)
    .where(
      and(
        eq(metaTrackingConfigVersion.accountId, args.accountId),
        isNull(metaTrackingConfigVersion.validTo),
      ),
    );

  // `jsonb_exists_any` é a forma funcional do operador `?` — preferida porque o
  // `?` literal é ambíguo para drivers que o usam como placeholder.
  const lifecycle = await db
    .selectDistinctOn(
      [metaTrackingChangeEvent.entityLevel, metaTrackingChangeEvent.entityId],
      {
        entityLevel: metaTrackingChangeEvent.entityLevel,
        entityId: metaTrackingChangeEvent.entityId,
        effectiveStatus: sql<
          string | null
        >`${metaTrackingChangeEvent.changedFields} -> 'effective_status' ->> 'new'`,
        occurredAt: metaTrackingChangeEvent.occurredAt,
      },
    )
    .from(metaTrackingChangeEvent)
    .where(
      and(
        eq(metaTrackingChangeEvent.accountId, args.accountId),
        sql`jsonb_exists_any(${metaTrackingChangeEvent.changedFields}, ARRAY['effective_status']::text[])`,
      ),
    )
    .orderBy(
      metaTrackingChangeEvent.entityLevel,
      metaTrackingChangeEvent.entityId,
      desc(metaTrackingChangeEvent.occurredAt),
    );

  return buildTrackedEntityStates({
    versions: versions.map((row) => ({
      ...row,
      config: row.config as Record<string, unknown>,
    })),
    lifecycle,
  });
}

/**
 * As ações que a PRÓPRIA plataforma registrou nesta conta desde `since` — as
 * rotas do backoffice (com motivo) e as do painel do cliente.
 *
 * Sem isso a coleta do dia seguinte escreveria um segundo evento, anônimo, para
 * a mudança que já tem autor e motivo no stream. É a matéria-prima da
 * deduplicação; quem decide o que casa é a costura pura.
 */
export async function loadRecentInternalChangeEvents(args: {
  accountId: string;
  since: Date;
}): Promise<RecentInternalChange[]> {
  const rows = await db
    .select({
      changeEventId: metaTrackingChangeEvent.id,
      entityLevel: metaTrackingChangeEvent.entityLevel,
      entityId: metaTrackingChangeEvent.entityId,
      changeKind: metaTrackingChangeEvent.changeKind,
      changedFields: metaTrackingChangeEvent.changedFields,
      occurredAt: metaTrackingChangeEvent.occurredAt,
    })
    .from(metaTrackingChangeEvent)
    .where(
      and(
        eq(metaTrackingChangeEvent.accountId, args.accountId),
        inArray(metaTrackingChangeEvent.source, [
          "backoffice_admin",
          "frontend_user",
        ]),
        gte(metaTrackingChangeEvent.occurredAt, args.since),
      ),
    )
    .orderBy(desc(metaTrackingChangeEvent.occurredAt));

  return rows.map((row) => ({
    ...row,
    changedFields: row.changedFields as MetaTrackingChangedFields,
  }));
}

/**
 * Grava o delta de uma conta. Tudo numa transação só, nesta ordem:
 *
 * 1. **Confirmações** — `last_confirmed_at` e as seis colunas voláteis da
 *    versão vigente. Volátil muda sem abrir versão; a confirmação traz o valor
 *    fresco.
 * 2. **Versões** — fecha a anterior (`valid_to = valid_from` da nova) e insere a
 *    nova. Juntas, sempre.
 * 3. **Eventos** — com `to_config_version_id` já apontando para o uuid recém
 *    inserido (a costura entrega `toVersionRef`, que só ela sabe resolver).
 * 4. **Ligações** — as ações já registradas por escrita interna ganham a versão
 *    nova como destino, em vez de um evento duplicado.
 */
export async function persistAccountTrackingDelta(args: {
  runId: string;
  delta: TrackingDelta;
}): Promise<PersistDeltaResult> {
  const { runId, delta } = args;
  if (
    delta.versions.length === 0 &&
    delta.events.length === 0 &&
    delta.confirmations.length === 0 &&
    delta.versionLinks.length === 0
  ) {
    return {
      versionsCreated: 0,
      eventsCreated: 0,
      versionsConfirmed: 0,
      eventsLinked: 0,
    };
  }

  return db.transaction(async (tx) => {
    for (const confirmation of delta.confirmations) {
      await tx
        .update(metaTrackingConfigVersion)
        .set({
          lastConfirmedAt: confirmation.lastConfirmedAt,
          ...confirmation.volatile,
        })
        .where(eq(metaTrackingConfigVersion.id, confirmation.versionId));
    }

    const versionIdByRef = new Map<string, string>();
    for (const version of delta.versions) {
      if (version.supersedesVersionId) {
        await tx
          .update(metaTrackingConfigVersion)
          .set({ validTo: version.validFrom })
          .where(
            and(
              eq(metaTrackingConfigVersion.id, version.supersedesVersionId),
              isNull(metaTrackingConfigVersion.validTo),
            ),
          );
      }

      const [inserted] = await tx
        .insert(metaTrackingConfigVersion)
        .values({
          ...version.columns,
          ...version.volatile,
          userId: version.userId,
          accountId: version.accountId,
          entityLevel: version.entityLevel,
          entityId: version.entityId,
          entityName: version.entityName,
          campaignId: version.campaignId,
          adsetId: version.adsetId,
          versionNumber: version.versionNumber,
          validFrom: version.validFrom,
          lastConfirmedAt: version.lastConfirmedAt,
          firstSeenRunId: runId,
          configHash: version.configHash,
          config: version.config,
          isManaged: version.isManaged,
        })
        .returning({ id: metaTrackingConfigVersion.id });

      if (!inserted) {
        throw new Error(
          `Failed to insert config version for ${version.entityLevel}:${version.entityId}`,
        );
      }
      versionIdByRef.set(version.ref, inserted.id);
    }

    if (delta.events.length > 0) {
      await tx.insert(metaTrackingChangeEvent).values(
        delta.events.map((event) => ({
          userId: event.userId,
          accountId: event.accountId,
          entityLevel: event.entityLevel,
          entityId: event.entityId,
          entityName: event.entityName,
          campaignId: event.campaignId,
          adsetId: event.adsetId,
          changeKind: event.changeKind,
          changedFields: event.changedFields,
          fromConfigVersionId: event.fromConfigVersionId,
          toConfigVersionId: event.toVersionRef
            ? (versionIdByRef.get(event.toVersionRef) ?? null)
            : null,
          source: event.source,
          occurredAt: event.occurredAt,
          detectedAt: event.detectedAt,
          detectionRunId: runId,
        })),
      );
    }

    let eventsLinked = 0;
    for (const link of delta.versionLinks) {
      const versionId = versionIdByRef.get(link.toVersionRef);
      if (!versionId) continue;
      await tx
        .update(metaTrackingChangeEvent)
        .set({ toConfigVersionId: versionId })
        .where(eq(metaTrackingChangeEvent.id, link.changeEventId));
      eventsLinked += 1;
    }

    return {
      versionsCreated: delta.versions.length,
      eventsCreated: delta.events.length,
      versionsConfirmed: delta.confirmations.length,
      eventsLinked,
    };
  });
}
