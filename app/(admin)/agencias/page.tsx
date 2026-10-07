import { listAgencies } from "@/lib/agencies/queries";
import { requirePagePermission } from "@/lib/auth/rbac";
import { AgenciesClient } from "./agencies-client";

export const dynamic = "force-dynamic";

export default async function AgenciesPage() {
  await requirePagePermission("agencies:manage");
  const agencies = await listAgencies();

  return (
    <AgenciesClient
      initialAgencies={agencies.map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.createdAt.toISOString(),
        owners: item.owners,
        memberCount: item.memberCount,
        pendingOwnerInvitation: item.pendingOwnerInvitation
          ? {
              email: item.pendingOwnerInvitation.email,
              expiresAt: item.pendingOwnerInvitation.expiresAt.toISOString(),
            }
          : null,
      }))}
    />
  );
}
