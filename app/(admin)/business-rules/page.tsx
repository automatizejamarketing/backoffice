import { requirePagePermission } from "@/lib/auth/rbac";
import {
  getBusinessOperatingRules,
  listBusinessRuleChangeLogs,
} from "@/lib/db/business-queries";
import {
  listProactivityAlertChangeLogs,
  listProactivityAlerts,
} from "@/lib/db/proactivity-alert-queries";
import { BusinessRulesPageClient } from "./business-rules-page-client";

export const dynamic = "force-dynamic";

/** postgres-js / Drizzle may return timestamp columns as Date or string. */
function toIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date(0).toISOString();
}

export default async function BusinessRulesPage() {
  await requirePagePermission("business:manage");
  const [rules, logs, proactivityAlerts, proactivityLogs] = await Promise.all([
    getBusinessOperatingRules(),
    listBusinessRuleChangeLogs(25),
    listProactivityAlerts(),
    listProactivityAlertChangeLogs(40),
  ]);

  return (
    <BusinessRulesPageClient
      initialRules={{
        ...rules,
        createdAt: toIso(rules.createdAt),
        updatedAt: toIso(rules.updatedAt),
      }}
      initialLogs={logs.map((log) => ({
        ...log,
        createdAt: toIso(log.createdAt),
      }))}
      initialProactivityAlerts={proactivityAlerts.map((alert) => ({
        id: alert.id,
        ruleKey: alert.ruleKey,
        audience: alert.audience,
        enabled: alert.enabled,
        thresholds: alert.thresholds,
        deliverWhatsapp: alert.deliverWhatsapp,
        deliverSlack: alert.deliverSlack,
        updatedByEmail: alert.updatedByEmail,
        createdAt: toIso(alert.createdAt),
        updatedAt: toIso(alert.updatedAt),
        definition: {
          title: alert.definition.title,
          description: alert.definition.description,
          thresholdFields: alert.definition.thresholdFields,
          defaultThresholds: alert.definition.defaultThresholds,
        },
      }))}
      initialProactivityLogs={proactivityLogs.map((log) => ({
        ...log,
        createdAt: toIso(log.createdAt),
      }))}
    />
  );
}
