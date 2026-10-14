import { redirect } from "next/navigation";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import { listManagedAgencies } from "@/lib/agency/agencies";
import { AgenciesClient } from "./agencies-client";

export const dynamic = "force-dynamic";

/** Admin vê e cria agências; o Dono vai direto para a dele. */
export default async function AgenciesPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const actor = await getCurrentBackofficeActor();
  if (!actor) redirect("/login");
  const { erro } = await searchParams;
  if (!hasBackofficePermission(actor, "team:manage")) {
    // Erro do OAuth do ClickUp volta para cá; o Dono o vê na tela de conexão da agência dele.
    const suffix = erro ? `/clickup?erro=${encodeURIComponent(erro)}` : "";
    if (hasBackofficePermission(actor, "agency:manage") && actor.agencyId) redirect(`/agencias/${actor.agencyId}${suffix}`);
    redirect("/trafego");
  }
  const agencies = await listManagedAgencies(actor);
  return <AgenciesClient initial={agencies.map((a) => ({ id: a.id, name: a.name, clients: a.clients, people: a.people }))} />;
}
