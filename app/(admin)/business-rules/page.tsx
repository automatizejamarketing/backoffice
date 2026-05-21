import { requirePagePermission } from "@/lib/auth/rbac";
import {
  getBusinessOperatingRules,
  listBusinessRuleChangeLogs,
} from "@/lib/db/business-queries";
import { BusinessRulesPageClient } from "./business-rules-page-client";

export const dynamic = "force-dynamic";

export default async function BusinessRulesPage() {
  await requirePagePermission("business:manage");
  const [rules, logs] = await Promise.all([
    getBusinessOperatingRules(),
    listBusinessRuleChangeLogs(25),
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
    />
  );
}
