import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/rbac";
import { getMetaBatch } from "@/lib/mcp/meta-batch";
import { BatchClient } from "./batch-client";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lote de ações em Meta Ads preparado pelo MCP: a pessoa revisa e aprova aqui, e só aqui ele roda. */
export default async function MetaBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("marketing:write");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const batch = await getMetaBatch(actor, id).catch(() => null);
  if (!batch) notFound();
  return <BatchClient initial={batch.described} isOwner={batch.row.actorId === actor.id} />;
}
