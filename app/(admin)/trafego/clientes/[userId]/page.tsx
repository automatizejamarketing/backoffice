import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/rbac";
import { getWorkspaceClientDetail, getWorkspaceClients } from "@/lib/consultant-workspace/data";
import { getJourneyExtras } from "@/lib/consultant-workspace/journey-data";
import { workspaceRange } from "@/lib/consultant-workspace/metrics";
import { ClientJourneyView } from "@/components/consultant-workspace/cliente/client-view";
import { parseDays } from "@/components/consultant-workspace/common/routes";
import { isUuid, readStateFor } from "@/components/consultant-workspace/common/server-data";
import { getStoppedSpend } from "@/components/consultant-workspace/jornada/server-data";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cliente · Tráfego" };

function serverNow() {
  return Date.now();
}

export default async function TrafegoClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, { userId }, query] = await Promise.all([
    requirePagePermission("marketing:read"),
    params,
    searchParams,
  ]);
  if (!isUuid(userId)) notFound();
  const days = parseDays(query.dias);
  // Fora da carteira ou sem acesso ativo: a leitura volta vazia e a página é "não encontrado".
  const detail = await getWorkspaceClientDetail(actor, userId, days);
  if (!detail) notFound();
  const [extras, stopped, store, stageClient] = await Promise.all([
    getJourneyExtras([userId]),
    getStoppedSpend([userId]),
    readStateFor(actor),
    // A etapa é sempre medida em 7 dias (igual ao quadro), mesmo vendo 14 ou 30.
    days === 7
      ? Promise.resolve(detail.client)
      : getWorkspaceClients(actor, { days: 7, onlyUserId: userId }).then(
          ({ clients }) => clients[0] ?? detail.client,
        ),
  ]);
  return (
    <ClientJourneyView
      detail={detail}
      stageClient={stageClient}
      extras={extras[userId] ?? null}
      stopped={stopped[userId] ?? null}
      range={workspaceRange(days)}
      initialStore={store}
      now={serverNow()}
    />
  );
}
