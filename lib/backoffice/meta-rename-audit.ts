/**
 * O dual-write de um renomeio feito pelo backoffice: o log legado de auditoria
 * e o evento novo no stream de ações, com a ponte entre os dois.
 *
 * Renomear parece inofensivo e não é: o nome da campanha carrega o prefixo de
 * Campanha Gerenciada, e a marca de gerenciada é avaliada POR VERSÃO. Um
 * renomeio muda a história dali para a frente — e o `name` entra no hash da
 * configuração, ou seja, a coleta do dia seguinte abriria versão nova e
 * escreveria "mudança detectada externamente" se ninguém tivesse registrado que
 * foi o gestor.
 *
 * Nunca lança: o objeto já foi renomeado na Meta quando isto roda.
 */

import { logMetaMutationError } from "@/lib/observability/meta-logger";
import {
  createRenameLog,
  type DuplicationEntity,
} from "@/lib/db/admin-queries";
import { recordInternalChangeEvent } from "@/lib/db/meta-tracking-event-queries";
import { buildInternalChangeEvent } from "@/lib/meta-tracking/internal-change-event";

export type RenameAuditInput = {
  entity: DuplicationEntity;
  backofficeUserEmail: string;
  /** Dono da conta de anúncio — o cliente, não o gestor. */
  targetUserId: string;
  /** Sempre no formato `act_<id>`. */
  accountId: string;
  objectId: string;
  campaignId?: string | null;
  adsetId?: string | null;
  previousName: string | null;
  newName: string;
  note: string;
  occurredAt: Date;
};

export type RenameAuditResult = {
  logId?: string;
  auditLogFailed: boolean;
  auditLogError?: string;
};

export async function recordRenameAudit(
  input: RenameAuditInput,
): Promise<RenameAuditResult> {
  const result: RenameAuditResult = { auditLogFailed: false };

  try {
    const log = await createRenameLog({
      backofficeUserEmail: input.backofficeUserEmail,
      targetUserId: input.targetUserId,
      entity: input.entity,
      objectId: input.objectId,
      previousName: input.previousName ?? "",
      newName: input.newName,
      note: input.note,
    });
    result.logId = log?.id;
  } catch (error) {
    logMetaMutationError(error);
    console.error(
      "[meta-rename] Falha ao gravar backoffice_audit_logs:",
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
    entityName: input.newName,
    campaignId: input.campaignId,
    adsetId: input.adsetId,
    changeKind: "config_change",
    changes: [{ field: "name", old: input.previousName, new: input.newName }],
    actorEmail: input.backofficeUserEmail,
    note: input.note,
    occurredAt: input.occurredAt,
    // O renomeio só chega aqui depois que a Meta o aceitou — falha vira exceção
    // na rota, como já era antes desta fundação.
    appliedToMeta: true,
  });

  if (!event.ok) {
    result.auditLogFailed = true;
    result.auditLogError = event.issue.reason;
    return result;
  }

  if (event.event) await recordInternalChangeEvent(event.event);
  return result;
}
