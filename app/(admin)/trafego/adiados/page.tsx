import { requirePagePermission } from "@/lib/auth/rbac";
import { getSnoozedData } from "@/components/consultant-workspace/carteira/snoozed-data";
import { SnoozedView } from "@/components/consultant-workspace/carteira/snoozed-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Adiados · Tráfego" };

function serverNow() {
  return Date.now();
}

export default async function TrafegoAdiadosPage() {
  const actor = await requirePagePermission("marketing:read");
  const data = await getSnoozedData(actor);
  return <SnoozedView clients={data.clients} alerts={data.alerts} initialStore={data.store} now={serverNow()} />;
}
