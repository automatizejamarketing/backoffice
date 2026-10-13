import "server-only";
import { sql } from "drizzle-orm";
import { consultantSeesOnlyAssignedClients, type BackofficeActor } from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { readWorkspaceState } from "@/lib/consultant-workspace/state";
import type { WorkspaceState } from "@/lib/consultant-workspace/types";

/** Leituras compartilhadas pelas telas da área de Tráfego (somente SELECT). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID.test(value);
}

/** Estado do consultor; o consultor comum só recebe o da própria carteira. */
export function readStateFor(actor: BackofficeActor): Promise<WorkspaceState> {
  return consultantSeesOnlyAssignedClients(actor.role)
    ? readWorkspaceState({ userIds: actor.assignedUserIds ?? [] })
    : readWorkspaceState();
}

/**
 * Alertas que já saíram da lista de abertos (tratados ou adiados): id → cliente,
 * para contar "você tratou hoje". Só clientes visíveis.
 */
export async function getTouchedAlertUsers(
  store: WorkspaceState,
  liveAlertIds: Set<string>,
  visibleUserIds: Set<string>,
): Promise<Record<string, string>> {
  const touchedIds = Object.keys(store.alertActions).filter((id) => isUuid(id) && !liveAlertIds.has(id));
  if (touchedIds.length === 0) return {};
  const result = (await db.execute(sql`
    select id::text as id, user_id::text as user_id from performance_insights
    where id in (${sql.join(touchedIds.map((id) => sql`${id}::uuid`), sql`, `)})
  `)) as unknown as Array<{ id: string; user_id: string }>;
  const map: Record<string, string> = {};
  for (const row of Array.from(result)) {
    if (visibleUserIds.has(String(row.user_id))) map[String(row.id)] = String(row.user_id);
  }
  return map;
}
