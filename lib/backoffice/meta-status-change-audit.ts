/**
 * O dual-write de uma mudança de status feita pelo backoffice: o log legado de
 * auditoria e o evento novo no stream de ações, com a ponte entre os dois.
 *
 * Existe porque a mesma coisa acontece em três níveis — campanha, conjunto e
 * anúncio — e porque, até este ticket, **nenhum dos três registrava nada**: a
 * mudança de status era a única mutação do backoffice sem rastro (§7 do plano
 * `docs/plans/campaign-tracking-foundation.md`). Concentrar o registro aqui é o
 * que impede o ponto cego de voltar em um dos níveis.
 *
 * Nunca lança: a alteração já foi aplicada na conta do cliente quando isto
 * roda. A rota reporta a falha de auditoria na resposta (`auditLogFailed`),
 * como as rotas de edição já fazem.
 */

import { logMetaMutationError } from "@/lib/observability/meta-logger";
import {
  createStatusChangeLog,
  type DuplicationEntity,
} from "@/lib/db/admin-queries";
import { recordInternalChangeEvent } from "@/lib/db/meta-tracking-event-queries";
import { buildInternalChangeEvent } from "@/lib/meta-tracking/internal-change-event";

export type StatusChangeAuditInput = {
  entity: DuplicationEntity;
  backofficeUserEmail: string;
  /** Dono da conta de anúncio — o cliente, não o gestor. */
  targetUserId: string;
  /** Sempre no formato `act_<id>`. */
  accountId: string;
  objectId: string;
  objectName?: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
  previousStatus: string | null;
  newStatus: string;
  note: string;
  occurredAt: Date;
  appliedToMeta: boolean;
  errorMessage?: string;
};

export type StatusChangeAuditResult = {
  /** Id do log legado, quando gravado. */
  logId?: string;
  auditLogFailed: boolean;
  auditLogError?: string;
};

export async function recordStatusChangeAudit(
  input: StatusChangeAuditInput,
): Promise<StatusChangeAuditResult> {
  const result: StatusChangeAuditResult = { auditLogFailed: false };

  try {
    const log = await createStatusChangeLog({
      backofficeUserEmail: input.backofficeUserEmail,
      targetUserId: input.targetUserId,
      entity: input.entity,
      objectId: input.objectId,
      objectName: input.objectName,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      note: input.note,
    });
    result.logId = log?.id;
  } catch (error) {
    logMetaMutationError(error);
    console.error(
      "[meta-status-change] Falha ao gravar backoffice_audit_logs:",
      error,
    );
    result.auditLogFailed = true;
    result.auditLogError =
      error instanceof Error ? error.message : "Falha ao registrar auditoria";
  }

  const event = buildInternalChangeEvent({
    source: "backoffice_admin",
    userId: input.targetUserId,
    accountId: input.accountId,
    entityLevel: input.entity,
    entityId: input.objectId,
    entityName: input.objectName,
    campaignId: input.campaignId,
    adsetId: input.adsetId,
    changeKind: "status_transition",
    changes: [
      { field: "status", old: input.previousStatus, new: input.newStatus },
    ],
    actorEmail: input.backofficeUserEmail,
    note: input.note,
    occurredAt: input.occurredAt,
    appliedToMeta: input.appliedToMeta,
    errorMessage: input.errorMessage,
    legacy: result.logId
      ? { table: "backoffice_audit_logs", id: result.logId }
      : null,
  });

  // A rota já validou o motivo antes de tocar na Meta; se ainda assim faltar,
  // o silêncio seria pior do que o registro sem stream — a resposta avisa.
  if (!event.ok) {
    result.auditLogFailed = true;
    result.auditLogError = event.issue.reason;
    return result;
  }

  if (event.event) await recordInternalChangeEvent(event.event);
  return result;
}
