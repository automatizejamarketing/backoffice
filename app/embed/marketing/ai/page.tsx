import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth/rbac";
import { AiCampaignClient } from "@/app/(admin)/marketing/ai/ai-campaign-client";

/**
 * The same AI campaign flow as `/marketing/ai`, rendered under the embed layout so the client
 * drawer (an iframe on `/embed/users/[id]`) never shows the admin sidebar inside itself.
 */
export default async function EmbedMarketingAiCampaignPage() {
  await requirePagePermission("marketing:write");

  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Carregando…</p>}>
      <AiCampaignClient />
    </Suspense>
  );
}
