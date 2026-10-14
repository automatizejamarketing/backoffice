import { requirePagePermission } from "@/lib/auth/rbac";
import { PlaybooksView } from "@/components/consultant-workspace/jornada/playbooks";
import { getBoardData } from "@/components/consultant-workspace/jornada/server-data";

export const dynamic = "force-dynamic";

export const metadata = { title: "Playbooks · Tráfego" };

function serverNow() {
  return Date.now();
}

export default async function TrafegoPlaybooksPage() {
  const actor = await requirePagePermission("marketing:read");
  const data = await getBoardData(actor);
  return (
    <PlaybooksView
      clients={data.clients}
      alerts={data.alerts}
      extras={data.extras}
      initialStore={data.store}
      now={serverNow()}
    />
  );
}
