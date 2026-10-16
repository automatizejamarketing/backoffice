/** Linha de `backoffice_audit_logs` para adição/exclusão na Biblioteca de mídias. */
export const MEDIA_LIBRARY_AUDIT_FIELD = "media_library";
export type MediaLibraryAuditAction = "media_library_add" | "media_library_delete";

export function buildMediaLibraryAuditEntry(input: {
  action: MediaLibraryAuditAction;
  adminEmail: string;
  targetUserId: string;
  filename: string;
}) {
  const name = input.filename.trim() || "mídia";
  return {
    adminEmail: input.adminEmail.slice(0, 100),
    targetUserId: input.targetUserId,
    action: input.action,
    fieldName: MEDIA_LIBRARY_AUDIT_FIELD,
    oldValue: input.action === "media_library_delete" ? name : null,
    newValue: input.action === "media_library_add" ? name : "excluída",
    note: null,
  };
}
