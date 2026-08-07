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
        createdAt: rules.createdAt.toISOString(),
        updatedAt: rules.updatedAt.toISOString(),
      }}
      initialLogs={logs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
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
        createdAt: alert.createdAt.toISOString(),
        updatedAt: alert.updatedAt.toISOString(),
        definition: {
          title: alert.definition.title,
          description: alert.definition.description,
          thresholdFields: alert.definition.thresholdFields,
          defaultThresholds: alert.definition.defaultThresholds,
        },
      }))}
      initialProactivityLogs={proactivityLogs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
      }))}
    />
  );
}
