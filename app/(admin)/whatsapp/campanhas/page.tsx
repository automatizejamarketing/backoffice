import { requirePagePermission } from "@/lib/auth/rbac";
import { WhatsappCampaignsClient } from "./whatsapp-campaigns-client";
export const dynamic = "force-dynamic";
export default async function WhatsappCampaignsPage() {
  await requirePagePermission("whatsapp:campaigns");
  return <WhatsappCampaignsClient />;
}
