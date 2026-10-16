import "server-only";
import { sql } from "drizzle-orm";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { playbookAlertRuleTitle } from "@/lib/backoffice/playbook-alert-dashboard";
import { getWorkspaceClients } from "@/lib/consultant-workspace/data";
import type { WorkspaceState } from "@/lib/consultant-workspace/types";
import { isUuid, readStateFor } from "@/components/consultant-workspace/common/server-data";
import type { SnoozedAlert, SnoozedClient } from "./snoozed-view";

/** O que está adiado na carteira visível: clientes, alertas adiados e o estado (somente SELECT). */
export async function getSnoozedData(
  actor: BackofficeActor,
): Promise<{ clients: SnoozedClient[]; alerts: SnoozedAlert[]; store: WorkspaceState }> {
  const [{ clients }, store] = await Promise.all([getWorkspaceClients(actor, { days: 7 }), readStateFor(actor)]);
  const visible = new Set(clients.map((client) => client.userId));
  const ids = Object.entries(store.alertActions)
    .filter(([id, action]) => action.status === "snoozed" && isUuid(id))
    .map(([id]) => id);
  const rows = ids.length
    ? (Array.from(
        (await db.execute(sql`
          select id::text as id, user_id::text as user_id, rule_id, severity, entity_level, entity_name, evidence
          from performance_insights
          where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        `)) as unknown as Array<Record<string, unknown>>,
      ) as Array<Record<string, unknown>>)
    : [];
  const alerts: SnoozedAlert[] = rows
    .filter((row) => visible.has(String(row.user_id)))
    .map((row) => {
      const severity = String(row.severity);
      return {
        id: String(row.id),
        userId: String(row.user_id),
        ruleTitle: playbookAlertRuleTitle(String(row.rule_id)),
        severity: (["critical", "warning", "info"].includes(severity) ? severity : "info") as SnoozedAlert["severity"],
        entityLevel: String(row.entity_level ?? ""),
        entityName: row.entity_name ? String(row.entity_name) : null,
        evidence: String(row.evidence ?? "").slice(0, 240),
      };
    });
  return {
    clients: clients.map((client) => ({
      userId: client.userId,
      displayName: client.displayName,
      tier: client.plan.tier,
      consultant: { key: client.consultant.key, name: client.consultant.name },
    })),
    alerts,
    store,
  };
}
