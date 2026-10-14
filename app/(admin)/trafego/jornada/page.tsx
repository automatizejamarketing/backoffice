import { requirePagePermission } from "@/lib/auth/rbac";
import { JourneyBoard } from "@/components/consultant-workspace/jornada/board";
import { getBoardData } from "@/components/consultant-workspace/jornada/server-data";

export const dynamic = "force-dynamic";

export const metadata = { title: "Jornada · Tráfego" };

function serverNow() {
  return Date.now();
}

export default async function TrafegoJornadaPage() {
  const actor = await requirePagePermission("marketing:read");
  const data = await getBoardData(actor);
  return (
    <JourneyBoard
      range={data.range}
      clients={data.clients}
      alerts={data.alerts}
      extras={data.extras}
      stopped={data.stopped}
      touchedAlertUser={data.touchedAlertUser}
      initialStore={data.store}
      now={serverNow()}
    />
  );
}
