import { redirect } from "next/navigation";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import { listManagedAgencies } from "@/lib/agency/agencies";
import { AgenciesClient } from "./agencies-client";

export const dynamic = "force-dynamic";

/** Admin vê e cria agências; o Dono vai direto para a dele. */
export default async function AgenciesPage() {
  const actor = await getCurrentBackofficeActor();
  if (!actor) redirect("/login");
  if (!hasBackofficePermission(actor, "team:manage")) {
    if (hasBackofficePermission(actor, "agency:manage") && actor.agencyId) redirect(`/agencias/${actor.agencyId}`);
    redirect("/trafego");
  }
  const agencies = await listManagedAgencies(actor);
  return <AgenciesClient initial={agencies.map((a) => ({ id: a.id, name: a.name, clients: a.clients, people: a.people }))} />;
}
