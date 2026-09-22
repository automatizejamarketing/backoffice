import { requirePagePermission } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import { AmbassadorWorkspace } from "./workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const actor = await requirePagePermission("ambassadors:manage");
  return (
    <AmbassadorWorkspace
      canGrant={hasBackofficePermission(actor, "ambassadors:grant")}
      isAdmin={actor.role === "admin"}
    />
  );
}
