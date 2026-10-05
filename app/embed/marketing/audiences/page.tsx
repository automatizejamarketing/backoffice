import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth/rbac";
import AudiencesPage from "@/app/(admin)/marketing/audiences/page";

export default async function EmbedMarketingAudiencesPage() {
  await requirePagePermission("marketing:write");
  return <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Carregando…</p>}><AudiencesPage /></Suspense>;
}
