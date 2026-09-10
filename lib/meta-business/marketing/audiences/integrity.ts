/**
 * A pending import only compromises a list when there is evidence that Meta
 * may already have received part of the intended mutation. An action required
 * before the first remote mutation remains safe to retry or replace.
 */
export type AudienceImportIntegrityDetails = {
  known?: boolean;
  state?: string;
  pendingUnresolved?: boolean;
  confirmedBatches?: number;
  confirmedRecords?: number;
  rejectedRecords?: number;
};

export function compromisesAudienceImport(
  state: string | undefined,
  details?: AudienceImportIntegrityDetails,
): boolean {
  if (state === "partial" || state === "unknown") return true;
  if (state !== "action_required" || details?.pendingUnresolved !== true) return false;
  return [
    details.confirmedBatches,
    details.confirmedRecords,
    details.rejectedRecords,
  ].some((count) => (count ?? 0) > 0);
}
