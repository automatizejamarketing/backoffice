import { and, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { metaTrackingChangeEvent } from "@/lib/db/schema";
import { APPLY_FAILED_FIELD } from "@/lib/meta-tracking/internal-change-event";

/**
 * Origens de uma alteração que a plataforma de fato pediu à Meta.
 * `external_detected` é o coletor (primeira leitura da conta, status que a
 * Meta propaga, edição no Gerenciador). `system` não passa pelo gravador
 * interno. Tentativa recusada fica marcada em `changed_fields`.
 */
export const PLATFORM_ADJUSTMENT_SOURCES = [
  "frontend_user",
  "backoffice_admin",
] as const;

export function countsAsPlatformAdjustment(
  source: string,
  changedFields: Record<string, unknown> | null | undefined,
): boolean {
  if (
    source !== "frontend_user" &&
    source !== "backoffice_admin"
  ) {
    return false;
  }
  return changedFields?.[APPLY_FAILED_FIELD] === undefined;
}

export function platformAdjustmentWhere(
  userId: string,
  start: string,
  end: string,
): SQL {
  return and(
    eq(metaTrackingChangeEvent.userId, userId),
    inArray(metaTrackingChangeEvent.source, [...PLATFORM_ADJUSTMENT_SOURCES]),
    sql`${metaTrackingChangeEvent.changedFields}->${APPLY_FAILED_FIELD} is null`,
    gte(metaTrackingChangeEvent.occurredAt, new Date(`${start}T00:00:00Z`)),
    lte(metaTrackingChangeEvent.occurredAt, new Date(`${end}T23:59:59Z`)),
  )!;
}
