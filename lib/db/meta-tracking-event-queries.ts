/**
 * Execução em Postgres do gravador do stream de ações internas (§7 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Só I/O: um INSERT. Quem decide o que é um evento — motivo obrigatório,
 * formato do diff, aplicado vs falhou, ponte com o log legado — é a costura
 * pura `lib/meta-tracking/internal-change-event.ts`, e é lá que isso é testado.
 *
 * ## Por que gravar nunca derruba a mutação
 *
 * A alteração já foi aplicada na conta do cliente quando este INSERT acontece.
 * Perder o registro é ruim; desfazer a resposta de uma alteração que a Meta já
 * aceitou é pior — o gestor tentaria de novo e mexeria duas vezes. É o mesmo
 * contrato que os edit logs legados já seguem (`auditLogFailed` na resposta),
 * e por isso o retorno é `null` em vez de exceção.
 */

import { db } from "@/lib/db";
import { metaTrackingChangeEvent } from "@/lib/db/schema";
import type { InternalChangeEventDraft } from "@/lib/meta-tracking/internal-change-event";

async function insertInternalChangeEvent(
  draft: InternalChangeEventDraft,
): Promise<string> {
  const [row] = await db
    .insert(metaTrackingChangeEvent)
    .values({
      userId: draft.userId,
      accountId: draft.accountId,
      entityLevel: draft.entityLevel,
      entityId: draft.entityId,
      entityName: draft.entityName,
      campaignId: draft.campaignId,
      adsetId: draft.adsetId,
      changeKind: draft.changeKind,
      changedFields: draft.changedFields,
      source: draft.source,
      actorEmail: draft.actorEmail,
      note: draft.note,
      occurredAt: draft.occurredAt,
      detectedAt: draft.detectedAt,
      legacyEditLogTable: draft.legacyEditLogTable,
      legacyEditLogId: draft.legacyEditLogId,
    })
    .returning({ id: metaTrackingChangeEvent.id });

  if (!row) throw new Error("Failed to insert meta tracking change event");
  return row.id;
}

/**
 * Grava o evento sem nunca derrubar a rota que já aplicou a mudança. Devolve o
 * id do evento, ou `null` quando a gravação falhou (o erro vai para o log da
 * aplicação, como no dual-write legado).
 */
export async function recordInternalChangeEvent(
  draft: InternalChangeEventDraft,
): Promise<string | null> {
  try {
    return await insertInternalChangeEvent(draft);
  } catch (error) {
    console.error(
      "[meta-tracking] Falha ao gravar meta_tracking_change_events:",
      error,
    );
    return null;
  }
}
