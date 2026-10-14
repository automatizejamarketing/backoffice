import { notFound, redirect } from "next/navigation";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import { AgencyError, getAgencyDetail } from "@/lib/agency/agencies";
import { AgencyClient } from "./agency-client";

export const dynamic = "force-dynamic";

export default async function AgencyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ plano?: string }> }) {
  const actor = await getCurrentBackofficeActor();
  if (!actor) redirect("/login");
  const { id } = await params;
  const detail = await getAgencyDetail(actor, id).catch((error) => {
    if (error instanceof AgencyError) return null;
    throw error;
  });
  if (!detail) notFound();
  return (
    <AgencyClient
      agency={detail.agency}
      plan={{ ...detail.plan, paidUntil: detail.plan.paidUntil?.toISOString() ?? null }}
      justPaid={(await searchParams).plano === "pago"}
      meId={actor.id}
      canAddClients={hasBackofficePermission(actor, "team:manage")}
      initialClients={detail.clients.map((c) => ({ ...c, addedAt: c.addedAt.toISOString() }))}
      initialPeople={detail.people}
    />
  );
}
