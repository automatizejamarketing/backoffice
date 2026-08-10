/**
 * Gravação do audit trail da Meta em Postgres (§4.4 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Só I/O. Quem decide o que é um evento cru, como ele é identificado e qual
 * ação ele explica é `lib/meta-tracking/activity-enrichment.ts`; quem coordena
 * é `lib/meta-tracking/collect-activity-events.ts`.
 *
 * ## As três regras que este arquivo carrega
 *
 * 1. **Upsert por `dedup_hash`.** O poll se sobrepõe em 48 h de propósito, então
 *    metade dos eventos de cada resposta já está gravada. O conflito atualiza
 *    `fetched_at` (e nada mais) — em particular **não** toca
 *    `matched_change_event_id`: um evento já ligado a uma ação não perde a
 *    ligação por ter sido visto de novo.
 * 2. **Só ação sem autor entra na fila do enriquecimento.** Ação registrada pela
 *    própria plataforma já tem autor e horário exatos; sobrescrevê-los com o que
 *    a Meta atribuiu seria trocar o certo pelo aproximado.
 * 3. **Os dois lados da ponte, na mesma transação.** `activity_event_id` no
 *    evento de mudança é a ponte canônica (tem FK); `matched_change_event_id` no
 *    evento cru é a volta, sem FK — o par de FKs mútuas obrigaria a ordenar
 *    inserts que o matcher faz em qualquer ordem.
 */

import { and, desc, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  metaTrackingActivityEvent,
  metaTrackingChangeEvent,
} from "@/lib/db/schema";
import type {
  ActivityLink,
  StoredActivityEvent,
} from "@/lib/meta-tracking/collect-activity-events";
import type {
  ActivityEventRow,
  EnrichableChange,
} from "@/lib/meta-tracking/activity-enrichment";

/**
 * Linhas por comando. Cada evento ocupa ~13 parâmetros; 400 deixa o comando bem
 * abaixo do teto de parâmetros do Postgres — o mesmo lote da série diária.
 */
const UPSERT_BATCH_SIZE = 400;

/**
 * Grava os eventos crus e devolve o uuid de cada um, novo ou já existente — é
 * esse uuid que o matcher precisa para escrever a ponte.
 *
 * TUDO é gravado, inclusive o que não tem relação com ação nenhuma (cobrança,
 * públicos, papéis da conta): o §4.4 os quer como matéria-prima de propósitos
 * futuros, e a retenção do endpoint não é documentada — o que não for capturado
 * hoje pode não existir amanhã.
 */
export async function upsertActivityEvents(
  rows: readonly ActivityEventRow[],
): Promise<StoredActivityEvent[]> {
  const stored: StoredActivityEvent[] = [];

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    if (batch.length === 0) continue;

    const fetchedAt = new Date();
    const affected = await db
      .insert(metaTrackingActivityEvent)
      .values(
        batch.map((row) => ({
          userId: row.userId,
          accountId: row.accountId,
          eventType: row.eventType,
          translatedEventType: row.translatedEventType,
          eventTime: row.eventTime,
          actorId: row.actorId,
          actorName: row.actorName,
          applicationId: row.applicationId,
          objectId: row.objectId,
          objectType: row.objectType,
          objectName: row.objectName,
          extraData: row.extraData,
          dedupHash: row.dedupHash,
          fetchedAt,
        })),
      )
      .onConflictDoUpdate({
        target: metaTrackingActivityEvent.dedupHash,
        // `fetched_at` e nada mais: é o carimbo de "visto de novo na
        // sobreposição", e é o que faz o comando devolver a linha existente.
        set: { fetchedAt },
      })
      .returning({
        id: metaTrackingActivityEvent.id,
        dedupHash: metaTrackingActivityEvent.dedupHash,
        matchedChangeEventId: metaTrackingActivityEvent.matchedChangeEventId,
      });

    stored.push(...affected);
  }

  return stored;
}

/**
 * As ações da conta que ainda esperam autor: detectadas pelo diff (ninguém
 * declarou quem foi) e ainda sem evento cru ligado.
 *
 * A janela é a mesma do poll, e não por simetria: uma ação mais antiga do que
 * isso já não tem como ser explicada, porque o evento que a explicaria não vem
 * mais na resposta. Fica pendente para sempre — anônima, com o horário da
 * detecção —, que é o comportamento honesto quando o audit trail não alcança.
 *
 * Da mais recente para a mais antiga: quando duas ações da mesma entidade
 * disputam o mesmo evento cru, a recente é a que ele explica.
 */
export async function loadEnrichableChangeEvents(args: {
  accountId: string;
  since: Date;
}): Promise<EnrichableChange[]> {
  const rows = await db
    .select({
      changeEventId: metaTrackingChangeEvent.id,
      entityLevel: metaTrackingChangeEvent.entityLevel,
      entityId: metaTrackingChangeEvent.entityId,
      changeKind: metaTrackingChangeEvent.changeKind,
      detectedAt: metaTrackingChangeEvent.detectedAt,
    })
    .from(metaTrackingChangeEvent)
    .where(
      and(
        eq(metaTrackingChangeEvent.accountId, args.accountId),
        eq(metaTrackingChangeEvent.source, "external_detected"),
        isNull(metaTrackingChangeEvent.activityEventId),
        gte(metaTrackingChangeEvent.detectedAt, args.since),
      ),
    )
    .orderBy(desc(metaTrackingChangeEvent.detectedAt));

  return rows;
}

/**
 * Escreve a ponte dos dois lados e devolve quantas ações foram de fato
 * enriquecidas.
 *
 * O `WHERE … activity_event_id IS NULL` do primeiro UPDATE é o que torna a
 * operação idempotente: se outra execução ligou essa ação no meio do caminho,
 * este comando não a re-liga nem conta — e o evento cru, que não foi escolhido,
 * segue disponível para explicar outra coisa.
 */
export async function linkActivityMatches(
  links: readonly ActivityLink[],
): Promise<number> {
  if (links.length === 0) return 0;

  return db.transaction(async (tx) => {
    let linked = 0;

    for (const link of links) {
      const applied = await tx
        .update(metaTrackingChangeEvent)
        .set({
          activityEventId: link.activityEventId,
          actorNameMeta: link.actorName,
          // O horário da ação passa a ser o exato, e não o da observação.
          occurredAt: link.occurredAt,
        })
        .where(
          and(
            eq(metaTrackingChangeEvent.id, link.changeEventId),
            isNull(metaTrackingChangeEvent.activityEventId),
          ),
        )
        .returning({ id: metaTrackingChangeEvent.id });

      if (applied.length === 0) continue;

      await tx
        .update(metaTrackingActivityEvent)
        .set({ matchedChangeEventId: link.changeEventId })
        .where(eq(metaTrackingActivityEvent.id, link.activityEventId));

      linked += 1;
    }

    return linked;
  });
}
