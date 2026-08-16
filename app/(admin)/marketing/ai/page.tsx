import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth/rbac";
import { AiCampaignClient } from "./ai-campaign-client";

export default async function MarketingAiCampaignPage() {
  await requirePagePermission("marketing:write");

  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Carregando…</p>}>
      <AiCampaignClient />
    </Suspense>
  );
}
