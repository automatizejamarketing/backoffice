import { requirePagePermission } from "@/lib/auth/rbac";
import { listBackofficeUsers } from "@/lib/db/backoffice-rbac-queries";
import { TeamPageClient } from "./team-page-client";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  await requirePagePermission("team:manage");
  const users = await listBackofficeUsers();

  return (
    <TeamPageClient
      initialUsers={users.map((user) => ({
        ...user,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      }))}
    />
  );
}
