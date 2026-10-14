import { notFound, redirect } from "next/navigation";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { AgencyError, getAgencyDetail } from "@/lib/agency/agencies";
import { connectionView } from "@/lib/clickup/connect";
import { ClickupSetup } from "./clickup-setup";

export const dynamic = "force-dynamic";

export default async function AgencyClickupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ conectado?: string; erro?: string }>;
}) {
  const actor = await getCurrentBackofficeActor();
  if (!actor) redirect("/login");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const detail = await getAgencyDetail(actor, id).catch((error) => {
    if (error instanceof AgencyError) return null;
    throw error;
  });
  if (!detail) notFound();
  const view = await connectionView(actor, id);
  return (
    <ClickupSetup
      agency={detail.agency}
      clients={detail.clients.map((c) => ({ userId: c.userId, label: c.companyName?.trim() || c.name || c.email }))}
      initial={view}
      flash={query.erro ? { kind: "error", text: query.erro } : query.conectado ? { kind: "ok", text: "ClickUp conectado. Agora mapeie a Lista de Publicação." } : null}
    />
  );
}
