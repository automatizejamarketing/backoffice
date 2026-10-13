import { requirePagePermission } from "@/lib/auth/rbac";
import { readStateFor } from "@/components/consultant-workspace/common/server-data";
import { MensagensView } from "@/components/consultant-workspace/jornada/mensagens";
import { getClientNames } from "@/components/consultant-workspace/jornada/server-data";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mensagens · Tráfego" };

function serverNow() {
  return Date.now();
}

export default async function TrafegoMensagensPage() {
  const actor = await requirePagePermission("marketing:read");
  const store = await readStateFor(actor);
  const names = await getClientNames(store.sentMessages.map((message) => message.userId));
  return <MensagensView initialStore={store} names={names} now={serverNow()} />;
}
