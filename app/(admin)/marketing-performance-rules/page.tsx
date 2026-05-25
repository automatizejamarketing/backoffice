import { requirePagePermission } from "@/lib/auth/rbac";
import { listCampaignPerformanceRules } from "@/lib/db/business-queries";
import { MarketingPerformanceRulesPageClient } from "./marketing-performance-rules-page-client";

export const dynamic = "force-dynamic";

export default async function MarketingPerformanceRulesPage() {
  await requirePagePermission("business:manage");
  const rules = await listCampaignPerformanceRules();

  return (
    <MarketingPerformanceRulesPageClient
      initialRules={rules.map((rule) => ({
        ...rule,
        createdAt: rule.createdAt.toISOString(),
        updatedAt: rule.updatedAt.toISOString(),
      }))}
    />
  );
}
